import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  permissionDefinitions,
  rolePermissionMatrix,
} from "../lib/auth/permissions.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202607310026_rbac_platform_owner.sql",
    import.meta.url,
  ),
  "utf8",
);

function section(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing migration section: ${start}`);
  assert.notEqual(endIndex, -1, `missing migration section end: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("database permission catalog matches the TypeScript catalog", () => {
  const permissionSeed = section(
    "insert into public.authorization_permissions",
    "insert into public.authorization_role_permissions",
  );
  const databasePermissions = [
    ...permissionSeed.matchAll(
      /\(\s*'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'\s*,\s*'(platform|organization)'/g,
    ),
  ].map((match) => ({ key: match[1], scope: match[2] }));
  const runtimePermissions = permissionDefinitions.map(({ key, scope }) => ({
    key,
    scope,
  }));

  assert.deepEqual(databasePermissions, runtimePermissions);
});

test("database trainer and viewer grants match the runtime matrix", () => {
  const explicitRoleSeed = section(
    "values\n  ('trainer', 'organization.read')",
    "alter table public.platform_admins",
  );
  const grants = [...explicitRoleSeed.matchAll(/\('(trainer|viewer)', '([^']+)'\)/g)];
  const databaseMatrix = {
    trainer: grants
      .filter((match) => match[1] === "trainer")
      .map((match) => match[2]),
    viewer: grants
      .filter((match) => match[1] === "viewer")
      .map((match) => match[2]),
  };

  assert.deepEqual(databaseMatrix.trainer, rolePermissionMatrix.trainer);
  assert.deepEqual(databaseMatrix.viewer, rolePermissionMatrix.viewer);
});

test("database permission check is fail closed for missing organization scope", () => {
  assert.match(
    migration,
    /permission\.scope = 'organization'[\s\S]+target_org_id is null[\s\S]+then false/,
  );
  assert.match(
    migration,
    /membership\.status = 'active'[\s\S]+organization\.status = 'active'/,
  );
});

test("platform-owner provisioning is service-only and final-owner safe", () => {
  const guard = section(
    "create or replace function public.protect_final_platform_owner",
    "alter table public.authorization_roles enable row level security",
  );
  const provisioning = section(
    "create or replace function public.provision_platform_owner",
    "revoke all on function public.provision_platform_owner",
  );

  assert.match(guard, /before update or delete on public\.platform_admins/);
  assert.match(guard, /join auth\.users as account/);
  assert.match(guard, /platform-owner:effective-assignment/);
  assert.match(guard, /remaining_owner_count < 1/);
  assert.match(
    provisioning,
    /auth\.role\(\) is distinct from 'service_role'/g,
  );
  assert.doesNotMatch(provisioning, /auth\.role\(\) <> 'service_role'/);
  assert.match(
    migration,
    /revoke insert, update, delete, truncate[\s\S]+on table public\.platform_admins[\s\S]+from service_role/,
  );
  assert.match(
    migration,
    /grant select on table public\.platform_admins to service_role/,
  );
});

test("service credentials cannot rewrite the fixed authorization catalog", () => {
  for (const table of [
    "authorization_roles",
    "authorization_permissions",
    "authorization_role_permissions",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from service_role`),
    );
    assert.match(
      migration,
      new RegExp(`grant select on table public\\.${table} to service_role`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`grant all on table public\\.${table} to service_role`),
    );
  }
});
