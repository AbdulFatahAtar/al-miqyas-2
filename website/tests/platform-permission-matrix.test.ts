import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canAccess,
  permissionDefinitions,
  permissionScope,
  roleHasPermission,
  rolePermissionMatrix,
  type Permission,
} from "../lib/auth/permissions.ts";

const rbacMigration = readFileSync(
  new URL(
    "../supabase/migrations/202607310026_rbac_platform_owner.sql",
    import.meta.url,
  ),
  "utf8",
);

const expectedPlatformPermissions = [
  "platform.dashboard.read",
  "organizations.read",
  "organizations.create",
  "organizations.update",
  "organizations.change_status",
  "users.read",
  "users.create",
  "users.update",
  "users.suspend",
  "memberships.manage_all",
  "roles.read",
  "roles.manage",
  "permissions.manage",
  "platform.settings.manage",
  "audit.read_all",
] as const satisfies readonly Permission[];

test("platform permission catalog is explicit and stable", () => {
  const actual = permissionDefinitions
    .filter(({ scope }) => scope === "platform")
    .map(({ key }) => key);

  assert.deepEqual(actual, expectedPlatformPermissions);
  assert.ok(actual.every((permission) => permissionScope(permission) === "platform"));
});

test("only platform_owner receives platform-scoped permissions", () => {
  for (const permission of expectedPlatformPermissions) {
    assert.equal(roleHasPermission("platform_owner", permission), true, permission);
    assert.equal(roleHasPermission("owner", permission), false, permission);
    assert.equal(roleHasPermission("trainer", permission), false, permission);
    assert.equal(roleHasPermission("viewer", permission), false, permission);
  }
});

test("platform checks ignore tenant memberships and fail closed for non-platform owners", () => {
  const organizationUser = {
    isPlatformOwner: false,
    organizationRoles: {
      "org-a": "owner",
      "org-b": "trainer",
    },
  } as const;
  const platformOwner = {
    isPlatformOwner: true,
    organizationRoles: {},
  } as const;

  for (const permission of expectedPlatformPermissions) {
    assert.equal(canAccess(organizationUser, permission), false, permission);
    assert.equal(canAccess(organizationUser, permission, "org-a"), false, permission);
    assert.equal(canAccess(platformOwner, permission), true, permission);
  }
});

test("platform_owner has the complete catalog and no undeclared permission", () => {
  const catalog = permissionDefinitions.map(({ key }) => key);
  assert.deepEqual([...rolePermissionMatrix.platform_owner], catalog);
  assert.equal(new Set(rolePermissionMatrix.platform_owner).size, catalog.length);
});

test("database seeds platform_owner from the full catalog and keeps provisioning off browser roles", () => {
  assert.match(
    rbacMigration,
    /select 'platform_owner', permission\.permission_key\s+from public\.authorization_permissions as permission;/,
  );
  assert.match(
    rbacMigration,
    /select 'owner', permission\.permission_key[\s\S]+where permission\.scope = 'organization';/,
  );
  for (const contract of ["provision_platform_owner", "revoke_platform_owner"]) {
    assert.match(
      rbacMigration,
      new RegExp(
        `revoke all on function public\\.${contract}\\(uuid, text\\)[\\s\\S]+?from authenticated;`,
      ),
    );
    assert.match(
      rbacMigration,
      new RegExp(
        `grant execute on function public\\.${contract}\\(uuid, text\\)[\\s\\S]+?to service_role;`,
      ),
    );
  }
});
