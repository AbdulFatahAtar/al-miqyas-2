import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const statementsRoute = read(
  "../app/api/integrations/xapi/statements/route.ts",
);
const serviceClient = read("../lib/supabase/service.ts");
const environmentExample = read("../.env.example");
const traineeDetails = read("../components/trainee-details-page.tsx");
const sessions = read("../components/sessions-live-page.tsx");
const xapiDisplay = read("../lib/xapi-display.ts");
const certificates = read("../components/certificates-live-page.tsx");
const jotformRoute = read(
  "../app/api/integrations/jotform/webhook/route.ts",
);
const jotformLibrary = read("../lib/jotform.ts");
const traineeRoute = read(
  "../app/api/public/trainees/[traineeCode]/route.ts",
);
const traineePage = read("../components/trainee-routing-page.tsx");
const assessmentLinkRoute = read(
  "../app/api/public/assessments/link/route.ts",
);
const accessRequestRoute = read(
  "../app/api/public/access-requests/route.ts",
);
const invitationAcceptance = read(
  "../app/api/access-requests/accept/route.ts",
);
const invitationPage = read("../components/accept-invitation-page.tsx");

test("public xAPI endpoint uses a fail-closed server-only Supabase client", () => {
  assert.match(statementsRoute, /createSupabaseServiceRoleClient\(\)/);
  assert.match(
    statementsRoute,
    /error instanceof SupabaseServiceConfigurationError/,
  );
  assert.doesNotMatch(
    statementsRoute,
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|createClient\(/,
  );

  assert.match(serviceClient, /import "server-only"/);
  assert.match(serviceClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serviceClient, /serviceRoleKey === publishableKey/);
  assert.match(environmentExample, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.doesNotMatch(
    environmentExample,
    /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test("browser read models do not request raw xAPI statements", () => {
  for (const source of [traineeDetails, sessions, xapiDisplay]) {
    assert.doesNotMatch(source, /raw_statement/);
  }
});

test("certificate page contains no development data generator", () => {
  assert.doesNotMatch(
    certificates,
    /createCertificateTestCandidate|createCertificateTest|certificateTestEmail|process_jotform_submission/,
  );
});

test("invitation acceptance reports suspended-user denial explicitly", () => {
  assert.match(
    invitationAcceptance,
    /suspended user cannot receive an active membership/,
  );
  assert.match(invitationAcceptance, /status: suspendedUser \? 403 : 400/);
});

test("invitation activation verifies the invited session before changing a password", () => {
  assert.ok(
    invitationPage.indexOf('fetch("/api/access-requests/accept"') <
      invitationPage.indexOf("supabase.auth.updateUser"),
  );
  assert.match(invitationPage, /state !== "password_pending"/);
  assert.match(invitationPage, /setState\("password_pending"\)/);
});

test("Jotform webhook authenticates before parsing and uses service role", () => {
  assert.match(jotformRoute, /authorizeJotformWebhook\(request\)/);
  assert.match(jotformRoute, /createSupabaseServiceRoleClient\(\)/);
  assert.doesNotMatch(
    jotformRoute,
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|createClient\(/,
  );
  assert.match(jotformLibrary, /process\.env\.JOTFORM_WEBHOOK_SECRET/);
  assert.match(jotformLibrary, /timingSafeEqual/);
  assert.ok(
    jotformRoute.indexOf("authorizeJotformWebhook(request)") <
      jotformRoute.indexOf("await request.arrayBuffer()"),
  );
  assert.match(jotformRoute, /rawBody\.byteLength > maximumWebhookBytes/);
  assert.match(jotformRoute, /parseJotformWebhook\(boundedRequest\)/);
  assert.match(environmentExample, /^JOTFORM_WEBHOOK_SECRET=$/m);
});

test("public trainee lookup is server-rate-limited and never returns certificate codes", () => {
  assert.match(traineeRoute, /createRequestFingerprint\(request\)/);
  assert.match(traineeRoute, /consume_public_api_rate_limit/);
  assert.match(traineeRoute, /createSupabaseServiceRoleClient\(\)/);
  assert.doesNotMatch(traineePage, /certificate_verify_code/);
  assert.doesNotMatch(traineePage, /supabase\.rpc\(\s*"get_public_trainee_route"/);
});

test("public assessment and access-request endpoints require server rate limits", () => {
  for (const source of [assessmentLinkRoute, accessRequestRoute]) {
    assert.match(source, /createRequestFingerprint\(request\)/);
    assert.match(source, /consume_public_api_rate_limit/);
    assert.match(source, /createSupabaseServiceRoleClient\(\)/);
    assert.doesNotMatch(
      source,
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|createClient\(/,
    );
  }

  assert.doesNotMatch(
    accessRequestRoute,
    /status: "duplicate"|status: "created"|referenceCode:/,
  );
  assert.match(accessRequestRoute, /status: "accepted"/);
});
