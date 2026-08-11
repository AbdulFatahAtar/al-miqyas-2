import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { normalizeIntlWhitespace } from "../lib/date-time.ts";
import { isTrustedSameOriginRequest } from "../lib/http/request-security.ts";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/202608020031_platform_admin_operations.sql",
    import.meta.url,
  ),
  "utf8",
);
const invitationRouteSource = readFileSync(
  new URL("../app/api/platform/invitations/route.ts", import.meta.url),
  "utf8",
);
const invitationDispatchSource = readFileSync(
  new URL("../lib/send-access-request-invitation.ts", import.meta.url),
  "utf8",
);
const auditComponentSource = readFileSync(
  new URL("../components/platform-audit-log.tsx", import.meta.url),
  "utf8",
);
const platformPageSource = readFileSync(
  new URL("../app/platform/page.tsx", import.meta.url),
  "utf8",
);
const organizationAdminSource = readFileSync(
  new URL("../components/platform-organization-admin.tsx", import.meta.url),
  "utf8",
);

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source section: ${start}`);
  assert.notEqual(endIndex, -1, `missing source section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function routeUuidPattern() {
  const match = invitationRouteSource.match(
    /const uuidPattern\s*=\s*(\/\^[\s\S]*?\$\/[a-z]*);/,
  );
  assert.ok(match, "platform invitation route must declare an anchored UUID pattern");
  return vm.runInNewContext(match[1]) as RegExp;
}

test("platform dates normalize browser-specific no-break spaces before hydration", () => {
  assert.equal(
    normalizeIntlWhitespace("٢٨/٠٧/٢٠٢٦، ٢:١٨\u00a0م"),
    "٢٨/٠٧/٢٠٢٦، ٢:١٨ م",
  );
  assert.equal(normalizeIntlWhitespace("09\u202fAug\u202f2026"), "09 Aug 2026");
  assert.match(platformPageSource, /normalizeIntlWhitespace\(dateFormatter\.format\(date\)\)/);
  assert.match(auditComponentSource, /normalizeIntlWhitespace\(dateFormatter\.format\(date\)\)/);
});

test("Migration 031 invitation RPC is authenticated, permission-gated, and tenant-bound", () => {
  const invitation = section(
    migrationSource,
    "create or replace function public.create_platform_user_invitation",
    "revoke all on function public.create_platform_user_invitation",
  );

  assert.match(invitation, /\(select auth\.uid\(\)\) is null/);
  assert.match(
    invitation,
    /has_permission\('users\.create', null\)[\s\S]+has_permission\('memberships\.manage_all', null\)/,
  );
  assert.match(invitation, /normalized_role not in \('owner', 'trainer', 'viewer'\)/);
  assert.match(
    invitation,
    /coalesce\(length\(normalized_reason\), 0\) not between 5 and 500/,
  );
  assert.match(
    invitation,
    /from public\.organizations as organization[\s\S]+organization\.id = target_org_id[\s\S]+organization\.status = 'active'[\s\S]+for update/,
  );
  assert.match(
    invitation,
    /access_request\.org_id = target_org_id[\s\S]+access_request\.email = normalized_email[\s\S]+access_request\.status in \('pending', 'approved', 'invited'\)/,
  );
  assert.match(
    invitation,
    /membership\.user_id = matched_user_id[\s\S]+membership\.org_id = target_org_id[\s\S]+membership\.status = 'active'/,
  );
});

test("Migration 031 invitation never creates credentials and distinguishes existing confirmed users", () => {
  const invitation = section(
    migrationSource,
    "create or replace function public.create_platform_user_invitation",
    "revoke all on function public.create_platform_user_invitation",
  );

  assert.match(invitation, /from auth\.users as account/);
  assert.match(invitation, /account\.email_confirmed_at is not null/);
  assert.match(
    invitation,
    /when matched_user_id is not null and matched_user_confirmed[\s\S]+then 'completed'[\s\S]+else 'approved'/,
  );
  assert.match(
    invitation,
    /if final_status = 'completed' then[\s\S]+insert into public\.memberships/,
  );
  assert.doesNotMatch(invitation, /encrypted_password|raw_app_meta_data|crypt\(|password/);
  assert.match(invitation, /'user\.access_granted'/);
  assert.match(invitation, /'user\.invitation_created'/);
  assert.match(invitation, /normalized_reason/);
  assert.match(invitation, /'channel', 'platform_invitation'/);
});

test("Migration 031 administrative RPCs are unavailable to anonymous callers", () => {
  for (const signature of [
    String.raw`public\.create_platform_user_invitation\(\s*uuid,\s*text,\s*text,\s*text,\s*text\s*\)`,
    String.raw`public\.list_platform_audit_events\(\s*text,\s*uuid,\s*uuid,\s*text,\s*text,\s*text,\s*text,\s*timestamptz,\s*timestamptz,\s*integer,\s*integer\s*\)`,
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`revoke all on function ${signature} from public, anon;`),
    );
    assert.match(
      migrationSource,
      new RegExp(`grant execute on function ${signature} to authenticated;`),
    );
  }
});

test("platform invitation route rejects cross-origin and cross-site requests before parsing JSON", () => {
  const routeUrl = "https://miqyas.example/api/platform/invitations";

  assert.equal(
    isTrustedSameOriginRequest(
      new Request(routeUrl, {
        method: "POST",
        headers: {
          origin: "https://miqyas.example",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(routeUrl, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    ),
    false,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(routeUrl, {
        method: "POST",
        headers: {
          origin: "https://miqyas.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(routeUrl, {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
      }),
    ),
    true,
  );
  assert.ok(
    invitationRouteSource.indexOf("if (!isTrustedSameOriginRequest(request))") <
      invitationRouteSource.indexOf("await request.json()"),
  );
});

test("platform invitation route accepts only complete RFC-shaped UUIDs", () => {
  const uuidPattern = routeUuidPattern();

  for (const valid of [
    "123e4567-e89b-12d3-a456-426614174000",
    "018f22d2-7c18-7cc3-9a32-f264c87d2d67",
    "123E4567-E89B-42D3-B456-426614174000",
  ]) {
    assert.equal(uuidPattern.test(valid), true, valid);
  }

  for (const invalid of [
    "123e4567-e89b-02d3-a456-426614174000",
    "123e4567-e89b-92d3-a456-426614174000",
    "123e4567-e89b-42d3-7456-426614174000",
    "123e4567-e89b-42d3-a456-426614174000-extra",
    "not-a-uuid",
  ]) {
    assert.equal(uuidPattern.test(invalid), false, invalid);
  }
});

test("platform invitation route validates input, session, permission, and RPC order", () => {
  assert.match(invitationRouteSource, /textField\(body, "organizationId"\)/);
  assert.match(invitationRouteSource, /textField\(body, "email"\)\.toLowerCase\(\)/);
  assert.match(invitationRouteSource, /!uuidPattern\.test\(organizationId\)/);
  assert.match(invitationRouteSource, /fullName\.length < 2/);
  assert.match(invitationRouteSource, /email\.length > 254/);
  assert.match(invitationRouteSource, /\["owner", "trainer", "viewer"\]\.includes\(role\)/);
  assert.match(invitationRouteSource, /reason\.length < 5/);
  assert.match(invitationRouteSource, /reason\.length > 500/);
  assert.match(invitationRouteSource, /supabase\.auth\.getUser\(\)/);
  assert.match(
    invitationRouteSource,
    /supabase\.rpc\(\s*"has_permission",[\s\S]+target_permission: "users\.create"[\s\S]+target_org_id: null/,
  );
  assert.match(
    invitationRouteSource,
    /permissionError \|\| permissionAllowed !== true/,
  );
  assert.match(
    invitationRouteSource,
    /supabase\.rpc\(\s*"create_platform_user_invitation"/,
  );
  assert.match(invitationRouteSource, /error\.code === "42501" \? 403 : 409/);
  assert.match(invitationRouteSource, /sendAccessRequestInvitation/);
  assert.doesNotMatch(invitationRouteSource, /\.from\(/);
});

test("email invitations exchange their one-time auth code before loading activation", () => {
  assert.match(
    invitationDispatchSource,
    /new URL\("\/auth\/callback", applicationUrl\)/,
  );
  assert.match(
    invitationDispatchSource,
    /callbackUrl\.searchParams\.set\("next", `\$\{invitationUrl\.pathname\}\$\{invitationUrl\.search\}`\)/,
  );
  assert.match(invitationDispatchSource, /emailRedirectTo: callbackUrl\.toString\(\)/);
  assert.doesNotMatch(invitationDispatchSource, /emailRedirectTo: invitationUrl\.toString\(\)/);
});

test("platform audit RPC validates outcomes, severity, date ranges, and page bounds", () => {
  const audit = section(
    migrationSource,
    "create or replace function public.list_platform_audit_events",
    "revoke all on function public.list_platform_audit_events",
  );

  assert.match(audit, /has_permission\('audit\.read_all', null\)/);
  assert.match(audit, /page_size not between 1 and 100/);
  assert.match(audit, /page_offset not between 0 and 100000/);
  assert.match(audit, /created_from > created_until/);
  assert.match(
    audit,
    /normalized_outcome not in \('success', 'denied', 'failure', 'partial'\)/,
  );
  assert.match(
    audit,
    /normalized_severity not in \('info', 'notice', 'warning', 'critical'\)/,
  );
  assert.match(audit, /audit\.outcome = normalized_outcome/);
  assert.match(audit, /audit\.severity = normalized_severity/);
  assert.match(audit, /count\(\*\) over\(\) as total_count/);
  assert.match(audit, /order by audit\.created_at desc, audit\.id desc/);
  assert.match(audit, /limit page_size\s+offset page_offset/);
  assert.doesNotMatch(audit, /before_data|after_data|metadata/);
});

test("platform audit UI forwards every filter and uses total-count pagination", () => {
  for (const filter of [
    "search_filter",
    "actor_user_filter",
    "organization_filter",
    "action_filter",
    "entity_type_filter",
    "outcome_filter",
    "severity_filter",
    "created_from",
    "created_until",
  ]) {
    assert.match(auditComponentSource, new RegExp(`${filter}:`));
  }

  for (const outcome of ["success", "denied", "failure", "partial"]) {
    assert.match(auditComponentSource, new RegExp(`value="${outcome}"`));
  }
  for (const severity of ["info", "notice", "warning", "critical"]) {
    assert.match(auditComponentSource, new RegExp(`value="${severity}"`));
  }

  assert.match(auditComponentSource, /const pageSize = 20/);
  assert.match(auditComponentSource, /page_size: pageSize/);
  assert.match(auditComponentSource, /page_offset: nextPage \* pageSize/);
  assert.match(auditComponentSource, /rows\[0\]\?\.total_count/);
  assert.match(auditComponentSource, /page === 0/);
  assert.match(auditComponentSource, /\(page \+ 1\) \* pageSize >= total/);
  assert.match(auditComponentSource, /loadPage\(page - 1\)/);
  assert.match(auditComponentSource, /loadPage\(page \+ 1\)/);
  assert.match(auditComponentSource, /aria-busy=\{isLoading\}/);
  assert.match(platformPageSource, /page_size: 20/);
  assert.match(platformPageSource, /page_offset: 0/);
  assert.match(
    platformPageSource,
    /created_at_label: formatDate\(row\.created_at\)/,
    "initial audit dates must be formatted on the server before hydration",
  );
  assert.match(auditComponentSource, /\{event\.created_at_label\}/);
  assert.doesNotMatch(
    auditComponentSource,
    /\{formatDate\(event\.created_at\)\}/,
    "the client must not reformat server-rendered audit dates during hydration",
  );
});

test("platform administration tabs implement the RTL keyboard contract", () => {
  assert.match(organizationAdminSource, /role="tablist"/);
  assert.match(organizationAdminSource, /role="tab"/);
  assert.match(organizationAdminSource, /aria-selected=\{tab === key\}/);
  assert.match(organizationAdminSource, /tabIndex=\{tab === key \? 0 : -1\}/);
  assert.match(organizationAdminSource, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(organizationAdminSource, /document\.documentElement\.dir === "rtl"/);
  assert.match(organizationAdminSource, /onKeyDown=\{\(event\) => moveTab\(event, key\)\}/);
  assert.match(organizationAdminSource, /querySelector<HTMLButtonElement>/);
  assert.match(organizationAdminSource, /\.focus\(\)/);
});
