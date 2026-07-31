import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { firstRpcRow } from "../../../../../lib/access-requests";
import { parseJotformWebhook } from "../../../../../lib/jotform";

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

export async function POST(request: Request) {
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

  let submission;

  try {
    submission = await parseJotformWebhook(request);
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json(
      { status: "failed", message: "Webhook service is unavailable." },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
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
