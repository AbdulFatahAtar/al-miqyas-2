export const xapiTestEventExtension =
  "https://miqyas.al-amad.com.sa/xapi/extensions/test-event";

export type XapiDisplayRecord = {
  id: string;
  statement_id: string;
  enrollment_id: string | null;
  trainee_code_received: string;
  program_id: string;
  session_id: string;
  verb_id: string;
  object_id: string;
  result: Record<string, unknown>;
  context: Record<string, unknown>;
  processing_status: "accepted" | "unmatched" | "rejected";
  rejection_reason: string | null;
  occurred_at: string;
  received_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function nestedRecord(
  source: Record<string, unknown>,
  key: string,
) {
  const value = source[key];
  return isRecord(value) ? value : null;
}

export function isXapiTestEvent(event: XapiDisplayRecord) {
  const extensions = nestedRecord(event.context, "extensions");
  return extensions?.[xapiTestEventExtension] === true;
}

export function xapiVerbLabel(verbId: string) {
  const key = verbId.split("/").filter(Boolean).at(-1) ?? verbId;
  const labels: Record<string, string> = {
    "experience-started": "بدأ التجربة",
    "scene-started": "بدأ المشهد",
    "item-attempted": "نفّذ بندًا",
    "hint-used": "استخدم تلميحًا",
    "scene-completed": "أكمل المشهد",
    "experience-completed": "أكمل التجربة",
  };

  return labels[key] ?? key;
}

export function xapiObjectLabel(event: XapiDisplayRecord) {
  return (
    event.object_id.split("/").filter(Boolean).at(-1) ??
    event.object_id
  );
}

export function xapiResultLabel(event: XapiDisplayRecord) {
  if (isXapiTestEvent(event)) {
    return "اختبار اتصال";
  }

  if (typeof event.result.success === "boolean") {
    return event.result.success ? "ناجح" : "غير ناجح";
  }

  if (typeof event.result.completion === "boolean") {
    return event.result.completion ? "مكتمل" : "قيد التنفيذ";
  }

  if (
    typeof event.result.response === "string" &&
    event.result.response.trim()
  ) {
    return event.result.response.trim();
  }

  const score = nestedRecord(event.result, "score");
  if (score && typeof score.raw === "number") {
    return String(score.raw);
  }

  return "تم الاستقبال";
}

export function shortSessionId(sessionId: string) {
  return sessionId.length > 16
    ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
    : sessionId;
}
