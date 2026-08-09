import { NextResponse } from "next/server";
import {
  createSupabaseServiceRoleClient,
  SupabaseServiceConfigurationError,
} from "../../../../../lib/supabase/service";
import {
  createXapiRequestId,
  hashXapiApiKey,
  parseXapiStatements,
  readXapiBearerToken,
  xapiVersion,
  XapiRequestError,
} from "../../../../../lib/xapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type XapiProcessingSummary = {
  status: "processed" | "mixed";
  accepted: number;
  duplicates: number;
  unmatched: number;
  rejected: number;
  results: Array<{
    statementId: string | null;
    status: "accepted" | "duplicate" | "unmatched" | "rejected";
    reason?: string;
  }>;
};

function databaseErrorStatus(message: string) {
  if (message.includes("API key")) {
    return 401;
  }

  if (message.includes("rate limit")) {
    return 429;
  }

  if (
    message.includes("statement") ||
    message.includes("payload") ||
    message.includes("request id")
  ) {
    return 400;
  }

  return 503;
}

export async function POST(request: Request) {
  try {
    if (
      request.headers.get("x-experience-api-version") !==
      xapiVersion
    ) {
      return NextResponse.json(
        {
          status: "rejected",
          message: `X-Experience-API-Version must be ${xapiVersion}.`,
        },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const token = readXapiBearerToken(request);
    const statements = await parseXapiStatements(request);
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc(
      "process_xapi_statements",
      {
        target_key_hash: hashXapiApiKey(token),
        target_request_id: createXapiRequestId(),
        target_statements: statements,
      },
    );

    if (error) {
      const diagnostic = [
        error.code || "unknown",
        error.message || "No message",
        error.details || "",
        error.hint || "",
      ]
        .filter(Boolean)
        .join(" | ");
      console.error(`xAPI processing error: ${diagnostic}`);
      const status = databaseErrorStatus(error.message);
      return NextResponse.json(
        {
          status: status === 401 ? "rejected" : "failed",
          message:
            status === 401
              ? "Organization API key is invalid or revoked."
              : status === 429
                ? "xAPI rate limit exceeded."
                : status === 400
                ? "xAPI payload validation failed."
                  : "xAPI processing failed.",
          ...(process.env.NODE_ENV !== "production"
            ? { diagnostic }
            : {}),
        },
        {
          status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const summary = data as XapiProcessingSummary | null;
    if (!summary) {
      return NextResponse.json(
        { status: "failed", message: "Processing returned no result." },
        { status: 503 },
      );
    }

    const responseStatus =
      summary.rejected > 0 || summary.unmatched > 0 ? 207 : 200;

    return NextResponse.json(summary, {
      status: responseStatus,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SupabaseServiceConfigurationError) {
      console.error(error.message);
      return NextResponse.json(
        { status: "failed", message: "xAPI service is unavailable." },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (error instanceof XapiRequestError) {
      return NextResponse.json(
        { status: "rejected", message: error.message },
        {
          status: error.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return NextResponse.json(
      { status: "failed", message: "xAPI request failed." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
