import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const blueprintPath = path.join(
  projectDirectory,
  "docs",
  "jotform",
  "diwan-onboarding-v1.blueprint.json",
);
const envPath = path.join(projectDirectory, ".env.local");
const defaultApiBaseUrls = [
  "https://api.jotform.com",
  "https://eu-api.jotform.com",
  "https://hipaa-api.jotform.com",
];
const applyChanges = process.argv.includes("--apply");

function parseEnvFile(source) {
  const values = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function createQuestionFactory() {
  let nextOrder = 0;

  return function question(properties) {
    return {
      ...properties,
      order: String(nextOrder++),
    };
  };
}

function buildQuestions(blueprint, form) {
  const question = createQuestionFactory();
  const confidenceOptions = Object.entries(
    blueprint.confidenceScale.labelsAr,
  ).map(([value, label]) => `${value} — ${label}`);

  const fields = [
    question({
      type: "control_head",
      name: "formHeader",
      text: form.titleAr,
      headerType: "Large",
    }),
    question({
      type: "control_text",
      name: "formIntroduction",
      text: form.descriptionAr,
    }),
    question({
      type: "control_textbox",
      name: "submissionToken",
      text: "رمز الإرسال",
      required: "Yes",
      readonly: "Yes",
      hidden: "Yes",
      size: "40",
      maxsize: "200",
      validation: "None",
      labelAlign: "Top",
    }),
    question({
      type: "control_textbox",
      name: "traineeId",
      text: "معرّف المتدرّب",
      required: "Yes",
      readonly: "Yes",
      hidden: "Yes",
      size: "20",
      maxsize: "9",
      validation: "None",
      labelAlign: "Top",
    }),
    question({
      type: "control_textbox",
      name: "assessmentKind",
      text: "نوع القياس",
      required: "Yes",
      readonly: "Yes",
      hidden: "Yes",
      size: "10",
      maxsize: "10",
      validation: "None",
      defaultValue: form.kind,
      labelAlign: "Top",
    }),
    question({
      type: "control_textbox",
      name: "programCode",
      text: "رمز البرنامج",
      required: "Yes",
      readonly: "Yes",
      hidden: "Yes",
      size: "30",
      maxsize: "50",
      validation: "None",
      defaultValue: blueprint.program.code,
      labelAlign: "Top",
    }),
    question({
      type: "control_textbox",
      name: "formVersion",
      text: "إصدار النموذج",
      required: "Yes",
      readonly: "Yes",
      hidden: "Yes",
      size: "5",
      maxsize: "5",
      validation: "Numeric",
      defaultValue: String(blueprint.program.formVersion),
      labelAlign: "Top",
    }),
    question({
      type: "control_head",
      name: "knowledgeHeading",
      text: "أسئلة المعرفة",
      headerType: "Small",
    }),
  ];

  for (const knowledgeQuestion of blueprint.knowledgeQuestions) {
    fields.push(
      question({
        type: "control_radio",
        name: knowledgeQuestion.key,
        text: knowledgeQuestion.promptAr,
        options: Object.values(knowledgeQuestion.options).join("|"),
        required: "Yes",
        allowOther: "No",
        spreadCols: "1",
        labelAlign: "Top",
      }),
    );
  }

  fields.push(
    question({
      type: "control_head",
      name: "confidenceHeading",
      text: "الثقة الذاتية",
      headerType: "Small",
    }),
  );

  for (const confidenceItem of blueprint.confidenceScale.items) {
    fields.push(
      question({
        type: "control_radio",
        name: confidenceItem.key,
        text: confidenceItem.promptAr,
        options: confidenceOptions.join("|"),
        required: "Yes",
        allowOther: "No",
        spreadCols: "1",
        labelAlign: "Top",
      }),
    );
  }

  fields.push(
    question({
      type: "control_button",
      name: "submitButton",
      text: form.submitButtonAr,
      buttonAlign: "Center",
      buttonStyle: "simple_blue",
      clear: "No",
      print: "No",
    }),
  );

  return fields;
}

function buildFormPayload(blueprint, form) {
  return {
    questions: buildQuestions(blueprint, form),
    properties: {
      title: form.titleAr,
      height: "600",
      formWidth: "760",
      labelWidth: "100",
      alignment: "Auto",
      styles: "nova",
      language: "Arabic",
      direction: "RTL",
      fontsize: "16",
      activeRedirect: "thanktext",
      thanktext: form.successMessageAr,
      hideMailEmptyFields: "enable",
    },
    emails: [],
  };
}

async function requestJotform(apiBaseUrl, apiKey, pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      APIKEY: apiKey,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Jotform returned a non-JSON response (${response.status}).`);
  }

  if (!response.ok || payload.responseCode !== 200) {
    const message =
      typeof payload.message === "string" ? payload.message : "Unknown error";
    throw new Error(`Jotform request failed (${response.status}): ${message}`);
  }

  return payload;
}

async function detectApiBaseUrl(apiKey, configuredBaseUrl) {
  const candidates = configuredBaseUrl
    ? [configuredBaseUrl.replace(/\/+$/u, "")]
    : defaultApiBaseUrls;
  const failures = [];

  for (const candidate of candidates) {
    try {
      await requestJotform(candidate, apiKey, "/user");
      await requestJotform(candidate, apiKey, "/user/forms?limit=1");
      return candidate;
    } catch (error) {
      failures.push({
        baseUrl: candidate,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const details = failures
    .map((failure) => `${failure.baseUrl}: ${failure.message}`)
    .join(" | ");
  throw new Error(`No Jotform API region allowed form access. ${details}`);
}

function normalizeForms(content) {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object") return Object.values(content);
  return [];
}

function normalizeQuestions(content) {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object") return Object.values(content);
  return [];
}

async function inspectForm(apiBaseUrl, apiKey, formId, expectedQuestions) {
  const questionsResponse = await requestJotform(
    apiBaseUrl,
    apiKey,
    `/form/${formId}/questions`,
  );
  const questions = normalizeQuestions(questionsResponse.content);
  const expectedNames = expectedQuestions.map((item) => item.name);
  const names = new Set(questions.map((item) => item.name));
  const missingNames = expectedNames.filter((name) => !names.has(name));
  const orderedQuestionNames = [...questions]
    .sort((left, right) => Number(left.order) - Number(right.order))
    .map((item) => item.name);
  const hiddenFields = questions
    .filter((item) =>
      [
        "submissionToken",
        "traineeId",
        "assessmentKind",
        "programCode",
        "formVersion",
      ].includes(item.name),
    )
    .map((item) => ({
      name: item.name,
      hidden: item.hidden ?? null,
      readonly: item.readonly ?? null,
    }));

  return {
    questionCount: questions.length,
    questionNames: questions.map((item) => item.name),
    orderedQuestionNames,
    orderMatches:
      JSON.stringify(orderedQuestionNames) === JSON.stringify(expectedNames),
    missingNames,
    hiddenFields,
  };
}

async function repairMissingQuestions(
  apiBaseUrl,
  apiKey,
  formId,
  expectedQuestions,
  missingNames,
) {
  const missingSet = new Set(missingNames);
  const missingQuestions = expectedQuestions.filter((question) =>
    missingSet.has(question.name),
  );

  if (missingQuestions.length !== missingNames.length) {
    throw new Error(
      `Cannot repair form ${formId}; missing question definitions were not found.`,
    );
  }

  await requestJotform(apiBaseUrl, apiKey, `/form/${formId}/questions`, {
    method: "PUT",
    body: JSON.stringify({
      questions: missingQuestions,
    }),
  });
}

async function createOrReuseForm(
  apiBaseUrl,
  apiKey,
  blueprint,
  form,
  existingForms,
) {
  const matches = existingForms.filter((item) => item.title === form.titleAr);
  if (matches.length > 1) {
    throw new Error(
      `More than one Jotform form already uses the title: ${form.titleAr}`,
    );
  }

  const expectedQuestions = buildQuestions(blueprint, form);

  if (matches.length === 1) {
    const existing = matches[0];
    let inspection = await inspectForm(
      apiBaseUrl,
      apiKey,
      existing.id,
      expectedQuestions,
    );
    if (inspection.missingNames.length > 0) {
      await repairMissingQuestions(
        apiBaseUrl,
        apiKey,
        existing.id,
        expectedQuestions,
        inspection.missingNames,
      );
      inspection = await inspectForm(
        apiBaseUrl,
        apiKey,
        existing.id,
        expectedQuestions,
      );
    }
    if (inspection.missingNames.length > 0) {
      throw new Error(
        `Existing form ${existing.id} remains incomplete; missing: ${inspection.missingNames.join(", ")}; names: ${inspection.questionNames.join(", ")}`,
      );
    }
    if (!inspection.orderMatches) {
      throw new Error(
        `Existing form ${existing.id} has an unexpected field order: ${inspection.orderedQuestionNames.join(", ")}`,
      );
    }

    return {
      action: "reused",
      id: String(existing.id),
      title: form.titleAr,
      url: existing.url ?? `https://form.jotform.com/${existing.id}`,
      status: existing.status ?? null,
      inspection,
    };
  }

  const createResponse = await requestJotform(
    apiBaseUrl,
    apiKey,
    "/user/forms",
    {
      method: "PUT",
      body: JSON.stringify(buildFormPayload(blueprint, form)),
    },
  );
  const created = createResponse.content;
  let inspection = await inspectForm(
    apiBaseUrl,
    apiKey,
    created.id,
    expectedQuestions,
  );
  if (inspection.missingNames.length > 0) {
    await repairMissingQuestions(
      apiBaseUrl,
      apiKey,
      created.id,
      expectedQuestions,
      inspection.missingNames,
    );
    inspection = await inspectForm(
      apiBaseUrl,
      apiKey,
      created.id,
      expectedQuestions,
    );
  }
  if (inspection.missingNames.length > 0) {
    throw new Error(
      `Created form ${created.id} remains incomplete; missing: ${inspection.missingNames.join(", ")}; names: ${inspection.questionNames.join(", ")}`,
    );
  }
  if (!inspection.orderMatches) {
    throw new Error(
      `Created form ${created.id} has an unexpected field order: ${inspection.orderedQuestionNames.join(", ")}`,
    );
  }

  return {
    action: "created",
    id: String(created.id),
    title: form.titleAr,
    url: created.url ?? `https://form.jotform.com/${created.id}`,
    status: created.status ?? null,
    inspection,
  };
}

async function main() {
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  const payloads = blueprint.forms.map((form) => ({
    kind: form.kind,
    title: form.titleAr,
    questionCount: buildQuestions(blueprint, form).length,
  }));

  if (!applyChanges) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          forms: payloads,
          knowledgeQuestions: blueprint.knowledgeQuestions.length,
          confidenceItems: blueprint.confidenceScale.items.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const env = parseEnvFile(await readFile(envPath, "utf8"));
  const apiKey = env.JOTFORM_API_KEY;
  if (!apiKey) {
    throw new Error("JOTFORM_API_KEY is missing from .env.local.");
  }

  const apiBaseUrl = await detectApiBaseUrl(
    apiKey,
    env.JOTFORM_API_BASE_URL,
  );
  const formsResponse = await requestJotform(
    apiBaseUrl,
    apiKey,
    "/user/forms",
  );
  const existingForms = normalizeForms(formsResponse.content);
  const results = [];

  for (const form of blueprint.forms) {
    const result = await createOrReuseForm(
      apiBaseUrl,
      apiKey,
      blueprint,
      form,
      existingForms,
    );
    results.push({
      kind: form.kind,
      ...result,
    });
    existingForms.push({
      id: result.id,
      title: result.title,
      url: result.url,
      status: result.status,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        apiRegion: new URL(apiBaseUrl).hostname,
        forms: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
