export type JotformWebhookData = {
  formId: string;
  submissionId: string;
  submissionToken: string;
  submittedAt: string | null;
  answers: Record<string, string>;
  payload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function scalarAnswer(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => scalarAnswer(item))
      .filter((item): item is string => item !== null && item !== "");
    return items.length > 0 ? items.join(", ") : null;
  }

  return null;
}

function normalizeQuestionName(key: string) {
  const prefixedName = key.match(/^q\d+_(.+)$/i)?.[1] ?? key;
  return prefixedName.replace(/\[[^\]]+\]$/u, "");
}

function addNormalizedAnswers(
  target: Record<string, string>,
  source: Record<string, unknown>,
) {
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (isRecord(rawValue)) {
      const name =
        typeof rawValue.name === "string"
          ? rawValue.name
          : normalizeQuestionName(rawKey);
      const answer = scalarAnswer(rawValue.answer);

      if (answer !== null && answer !== "") {
        target[name] = answer;
      }
      continue;
    }

    const answer = scalarAnswer(rawValue);
    if (answer !== null && answer !== "") {
      target[normalizeQuestionName(rawKey)] = answer;
    }
  }
}

function parseJsonRecord(value: unknown) {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(
  sources: Record<string, unknown>[],
  names: string[],
) {
  for (const source of sources) {
    for (const name of names) {
      const value = scalarAnswer(source[name]);
      if (value) {
        return value;
      }
    }
  }

  return "";
}

function submittedTimestamp(value: string) {
  if (!value) {
    return null;
  }

  const hasExplicitTimezone =
    /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value);

  if (!hasExplicitTimezone) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf())
    ? null
    : timestamp.toISOString();
}

function formDataRecord(formData: FormData) {
  const record: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      const existing = record[key];
      record[key] =
        typeof existing === "string"
          ? [existing, value]
          : Array.isArray(existing)
            ? [...existing, value]
            : value;
    }
  }

  return record;
}

async function requestRecord(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const parsed = (await request.json()) as unknown;
    return isRecord(parsed) ? parsed : null;
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return formDataRecord(await request.formData());
  }

  const text = await request.text();
  if (!text) {
    return null;
  }

  const parsedJson = parseJsonRecord(text);
  if (parsedJson) {
    return parsedJson;
  }

  return Object.fromEntries(new URLSearchParams(text));
}

export async function parseJotformWebhook(
  request: Request,
): Promise<JotformWebhookData | null> {
  const outerPayload = await requestRecord(request);
  if (!outerPayload) {
    return null;
  }

  const rawRequest =
    parseJsonRecord(outerPayload.rawRequest) ??
    parseJsonRecord(outerPayload.raw_request);
  const apiAnswers =
    rawRequest && isRecord(rawRequest.answers)
      ? rawRequest.answers
      : null;
  const sources = [
    outerPayload,
    ...(rawRequest ? [rawRequest] : []),
    ...(apiAnswers ? [apiAnswers] : []),
  ];
  const answers: Record<string, string> = {};

  addNormalizedAnswers(answers, outerPayload);
  if (rawRequest) {
    addNormalizedAnswers(answers, rawRequest);
  }
  if (apiAnswers) {
    addNormalizedAnswers(answers, apiAnswers);
  }

  const formId = firstString(sources, [
    "formID",
    "formId",
    "form_id",
  ]);
  const submissionId = firstString(sources, [
    "submissionID",
    "submissionId",
    "submission_id",
  ]);
  const submissionToken =
    answers.submissionToken ||
    firstString(sources, ["submissionToken"]);
  const submittedAtValue = firstString(sources, [
    "created_at",
    "createdAt",
    "submittedAt",
  ]);

  if (!formId || !submissionId || !submissionToken) {
    return null;
  }

  return {
    formId,
    submissionId,
    submissionToken,
    submittedAt: submittedTimestamp(submittedAtValue),
    answers,
    payload: {
      ...outerPayload,
      ...(rawRequest ? { rawRequest } : {}),
    },
  };
}
