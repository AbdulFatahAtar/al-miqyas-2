import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { firstRpcRow } from "../../../../../lib/access-requests";
import { parseJotformWebhook } from "../../../../../lib/jotform";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const maximumSubmissionsPerForm = 100;

type ActiveJotformForm = {
  form_id: string;
};

type ProcessingResult = {
  processing_result: "processed" | "duplicate" | "already_completed";
  assessment_id: string | null;
  ingestion_id: string | null;
};

type JotformSubmission = {
  id?: string | number;
  form_id?: string | number;
  created_at?: string | null;
  answers?: Record<string, unknown>;
};

type FailedSubmission = {
  formId: string;
  submissionId: string;
  payload: Record<string, unknown>;
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRows(value: unknown): JotformSubmission[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as JotformSubmission[];
  }

  if (isRecord(value)) {
    return Object.values(value).filter(isRecord) as JotformSubmission[];
  }

  return [];
}

function hasAuthorizedCronSecret(request: Request) {
  const configuredSecret = process.env.CRON_SECRET ?? "";
  const suppliedAuthorization = request.headers.get("authorization") ?? "";
  const suppliedSecret = suppliedAuthorization.replace(/^Bearer\s+/iu, "");

  if (
    configuredSecret.length < 32 ||
    configuredSecret.length > 512 ||
    suppliedSecret.length < 32 ||
    suppliedSecret.length > 512
  ) {
    return false;
  }

  const configuredDigest = createHash("sha256")
    .update(configuredSecret)
    .digest();
  const suppliedDigest = createHash("sha256")
    .update(suppliedSecret)
    .digest();

  return timingSafeEqual(configuredDigest, suppliedDigest);
}

async function fetchFormSubmissions(formId: string) {
  const apiKey = process.env.JOTFORM_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Jotform reconciliation is not configured.");
  }

  const response = await fetch(
    `https://api.jotform.com/form/${formId}/submissions?limit=${maximumSubmissionsPerForm}`,
    {
      headers: { APIKEY: apiKey, Accept: "application/json" },
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as {
    responseCode?: number;
    content?: unknown;
  };

  if (!response.ok || payload.responseCode !== 200) {
    throw new Error("Jotform reconciliation request failed.");
  }

  return normalizeRows(payload.content);
}

async function recordFailure(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  failure: FailedSubmission,
) {
  const { error } = await supabase.rpc(
    "record_integration_processing_failure",
    {
      target_provider: "jotform",
      target_channel: "reconciliation",
      target_external_event_id: failure.submissionId,
      target_form_id: failure.formId,
      target_payload: failure.payload,
      target_error: failure.reason,
    },
  );

  if (error) {
    console.error("Unable to record Jotform reconciliation failure.", error);
  }
}

async function runReconciliation() {
  const supabase = createSupabaseServiceRoleClient();
  const { data: configuredForms, error: formsError } = await supabase
    .from("jotform_forms")
    .select("form_id")
    .eq("is_active", true)
    .in("assessment_kind", ["pre", "post"]);

  if (formsError) {
    throw new Error("Unable to load active Jotform forms.");
  }

  const forms = (configuredForms ?? []) as ActiveJotformForm[];
  const summary = {
    formsChecked: forms.length,
    submissionsChecked: 0,
    processed: 0,
    duplicate: 0,
    alreadyCompleted: 0,
    skippedKnown: 0,
    rejected: 0,
    failed: 0,
  };

  for (const form of forms) {
    const submissions = await fetchFormSubmissions(form.form_id);
    const submissionIds = submissions
      .map((submission) => String(submission.id ?? ""))
      .filter((submissionId) => submissionId.length > 0);
    const { data: knownIngestions, error: knownIngestionsError } =
      submissionIds.length > 0
        ? await supabase
            .from("webhook_ingestions")
            .select("external_event_id")
            .eq("provider", "jotform")
            .in("external_event_id", submissionIds)
        : { data: [], error: null };

    if (knownIngestionsError) {
      throw new Error("Unable to load known Jotform ingestions.");
    }

    const knownSubmissionIds = new Set(
      (knownIngestions ?? []).map((ingestion) => ingestion.external_event_id),
    );

    for (const submission of submissions) {
      summary.submissionsChecked += 1;
      const rawRequest = {
        formID: String(submission.form_id ?? form.form_id),
        submissionID: String(submission.id ?? ""),
        created_at: submission.created_at ?? null,
        answers: submission.answers ?? {},
      };

      if (knownSubmissionIds.has(rawRequest.submissionID)) {
        summary.skippedKnown += 1;
        continue;
      }

      const parsed = await parseJotformWebhook(
        new Request("https://internal.miqyas/reconcile", {
          body: JSON.stringify({
            formID: rawRequest.formID,
            submissionID: rawRequest.submissionID,
            created_at: rawRequest.created_at,
            rawRequest: JSON.stringify(rawRequest),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      if (!parsed) {
        summary.rejected += 1;
        await recordFailure(supabase, {
          formId: rawRequest.formID,
          submissionId: rawRequest.submissionID,
          payload: rawRequest,
          reason: "Jotform response does not contain a valid submission token.",
        });
        continue;
      }

      const { data, error } = await supabase.rpc(
        "process_jotform_submission",
        {
          target_form_id: parsed.formId,
          target_submission_id: parsed.submissionId,
          target_submission_token: parsed.submissionToken,
          target_submitted_at: parsed.submittedAt,
          target_answers: parsed.answers,
          target_payload: parsed.payload,
          target_channel: "reconciliation",
        },
      );

      if (error) {
        summary.failed += 1;
        await recordFailure(supabase, {
          formId: parsed.formId,
          submissionId: parsed.submissionId,
          payload: parsed.payload,
          reason: error.message,
        });
        continue;
      }

      const result = firstRpcRow<ProcessingResult>(
        data as ProcessingResult[],
      );

      if (!result) {
        summary.failed += 1;
        await recordFailure(supabase, {
          formId: parsed.formId,
          submissionId: parsed.submissionId,
          payload: parsed.payload,
          reason: "Jotform processing returned no result.",
        });
      } else if (result.processing_result === "processed") {
        summary.processed += 1;
      } else if (result.processing_result === "duplicate") {
        summary.duplicate += 1;
      } else {
        summary.alreadyCompleted += 1;
      }
    }
  }

  return summary;
}

async function reconcile(request: Request) {
  if (!hasAuthorizedCronSecret(request)) {
    return NextResponse.json(
      { status: "rejected", message: "Cron authentication failed." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return NextResponse.json(
      { status: "completed", ...(await runReconciliation()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!(error instanceof SupabaseServiceConfigurationError)) {
      console.error("Jotform reconciliation failed.", error);
    }
    return NextResponse.json(
      { status: "failed", message: "Jotform reconciliation is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  return reconcile(request);
}

export async function POST(request: Request) {
  return reconcile(request);
}
