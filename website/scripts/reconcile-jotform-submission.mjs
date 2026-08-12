import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const envPath = path.join(projectDirectory, ".env.local");
const formId = process.argv[2];
const requestedSubmissionId = process.argv[3] ?? null;

function parseEnvFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        return [key, value];
      }),
  );
}

function normalizeRows(content) {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object") {
    return Object.values(content);
  }
  return [];
}

async function jotformRequest(apiKey, pathname) {
  const response = await fetch(`https://api.jotform.com${pathname}`, {
    headers: {
      APIKEY: apiKey,
      Accept: "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok || payload.responseCode !== 200) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : `Jotform request failed (${response.status}).`,
    );
  }

  return payload.content;
}

async function main() {
  if (!formId || !/^[0-9]{5,30}$/u.test(formId)) {
    throw new Error(
      "Usage: node scripts/reconcile-jotform-submission.mjs FORM_ID [SUBMISSION_ID]",
    );
  }

  const env = parseEnvFile(await readFile(envPath, "utf8"));
  if (!env.JOTFORM_API_KEY || !env.JOTFORM_WEBHOOK_SECRET) {
    throw new Error(
      "JOTFORM_API_KEY or JOTFORM_WEBHOOK_SECRET is missing from .env.local.",
    );
  }

  const submissions = normalizeRows(
    await jotformRequest(
      env.JOTFORM_API_KEY,
      `/form/${formId}/submissions`,
    ),
  );
  const submission = requestedSubmissionId
    ? submissions.find(
        (candidate) => String(candidate.id) === requestedSubmissionId,
      )
    : submissions[0];

  if (!submission) {
    throw new Error("The requested Jotform submission was not found.");
  }

  const applicationUrl = (
    env.RECONCILIATION_APPLICATION_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    "http://127.0.0.1:3000"
  ).replace(/\/+$/u, "");
  const rawRequest = {
    formID: String(submission.form_id ?? formId),
    submissionID: String(submission.id),
    created_at: submission.created_at ?? null,
    answers: submission.answers ?? {},
  };
  const response = await fetch(
    `${applicationUrl}/api/integrations/jotform/webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Miqyas-Webhook-Secret": env.JOTFORM_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        formID: rawRequest.formID,
        submissionID: rawRequest.submissionID,
        created_at: rawRequest.created_at,
        rawRequest: JSON.stringify(rawRequest),
      }),
    },
  );
  const result = await response.json();

  console.log(
    JSON.stringify(
      {
        formId: rawRequest.formID,
        submissionId: rawRequest.submissionID,
        httpStatus: response.status,
        processingStatus: result.status ?? null,
        assessmentId: result.assessmentId ?? null,
        scorePercentage: result.scorePercentage ?? null,
        confidenceMean: result.confidenceMean ?? null,
      },
      null,
      2,
    ),
  );

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
