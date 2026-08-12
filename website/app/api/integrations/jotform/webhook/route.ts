import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";
import {
  authorizeJotformWebhook,
  parseJotformWebhook,
} from "../../../../../lib/jotform";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumWebhookBytes = 1_000_000;

type ProcessingResult = {
  processing_result: "processed" | "duplicate" | "already_completed";
  assessment_id: string | null;
  ingestion_id: string | null;
  score_percentage: number | null;
  confidence_mean: number | null;
};

async function recordWebhookProcessingFailure(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  submission: {
    formId: string;
    submissionId: string;
    payload: Record<string, unknown>;
  },
  reason: string,
) {
  const { error } = await supabase.rpc(
    "record_integration_processing_failure",
    {
      target_provider: "jotform",
      target_channel: "webhook",
      target_external_event_id: submission.submissionId,
      target_form_id: submission.formId,
      target_payload: submission.payload,
      target_error: reason,
    },
  );

  if (error) {
    console.error("Unable to record Jotform webhook failure.", error);
  }
}

export async function POST(request: Request) {
  const authorization = authorizeJotformWebhook(request);
  if (authorization !== "authorized") {
    return NextResponse.json(
      {
        status: "rejected",
        message:
          authorization === "misconfigured"
            ? "Webhook service is unavailable."
            : "Webhook authentication failed.",
      },
      {
        status: authorization === "misconfigured" ? 503 : 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > maximumWebhookBytes
  ) {
    return NextResponse.json(
      { status: "rejected", message: "Payload is too large." },
      { status: 413 },
    );
  }

  let rawBody: ArrayBuffer;

  try {
    rawBody = await request.arrayBuffer();
  } catch {
    return NextResponse.json(
      { status: "rejected", message: "Malformed webhook payload." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (rawBody.byteLength > maximumWebhookBytes) {
    return NextResponse.json(
      { status: "rejected", message: "Payload is too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const boundedRequest = new Request(request.url, {
    body: rawBody,
    headers: request.headers,
    method: request.method,
  });
  let submission;

  try {
    submission = await parseJotformWebhook(boundedRequest);
  } catch {
    return NextResponse.json(
      { status: "rejected", message: "Malformed webhook payload." },
      { status: 400 },
    );
  }

  if (!submission) {
    return NextResponse.json(
      {
        status: "rejected",
        message: "Required Jotform submission fields are missing.",
      },
      { status: 400 },
    );
  }

  let supabase: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    supabase = createSupabaseServiceRoleClient();
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Jotform service setup failed.", error);
    }
    return NextResponse.json(
      { status: "failed", message: "Webhook service is unavailable." },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc(
    "process_jotform_submission",
    {
      target_form_id: submission.formId,
      target_submission_id: submission.submissionId,
      target_submission_token: submission.submissionToken,
      target_submitted_at: submission.submittedAt,
      target_answers: submission.answers,
      target_payload: submission.payload,
    },
  );

  if (error) {
    const isRejectedSubmission =
      error.code === "P0001" &&
      (error.message.includes("token") ||
        error.message.includes("required") ||
        error.message.includes("Invalid Jotform") ||
        error.message.includes("configuration"));

    await recordWebhookProcessingFailure(supabase, submission, error.message);

    return NextResponse.json(
      {
        status: isRejectedSubmission ? "rejected" : "failed",
        message: isRejectedSubmission
          ? "Submission validation failed."
          : "Submission processing failed.",
      },
      {
        status: isRejectedSubmission ? 422 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const result = firstRpcRow<ProcessingResult>(
    data as ProcessingResult[],
  );

  if (!result) {
    await recordWebhookProcessingFailure(
      supabase,
      submission,
      "Jotform processing returned no result.",
    );

    return NextResponse.json(
      { status: "failed", message: "Processing returned no result." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      status: result.processing_result,
      assessmentId: result.assessment_id,
      scorePercentage: result.score_percentage,
      confidenceMean: result.confidence_mean,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
