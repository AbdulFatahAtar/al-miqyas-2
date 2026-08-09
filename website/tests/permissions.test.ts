import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccess,
  pagePermissionForPath,
  permissionDefinitions,
  roleHasPermission,
  roleKeys,
  rolePermissionMatrix,
  type Permission,
} from "../lib/auth/permissions.ts";
import { safeInternalPath } from "../lib/auth/safe-redirect.ts";

test("permission keys and role assignments are unique and valid", () => {
  const known = new Set(permissionDefinitions.map(({ key }) => key));
  assert.equal(known.size, permissionDefinitions.length);

  for (const role of roleKeys) {
    const assigned = rolePermissionMatrix[role];
    assert.equal(new Set(assigned).size, assigned.length);
    assert.ok(assigned.every((permission) => known.has(permission)));
  }
});

test("platform owner permissions are explicit and complete", () => {
  const expected = permissionDefinitions.map(({ key }) => key).sort();
  const assigned = [...rolePermissionMatrix.platform_owner].sort();
  assert.deepEqual(assigned, expected);
});

test("organization roles cannot receive platform permissions", () => {
  const platformPermissions = permissionDefinitions
    .filter(({ scope }) => scope === "platform")
    .map(({ key }) => key);

  for (const role of ["owner", "trainer", "viewer"] as const) {
    assert.ok(
      platformPermissions.every(
        (permission) => !roleHasPermission(role, permission),
      ),
    );
  }
});

test("viewer is read only and trainer cannot manage memberships", () => {
  const mutationPermissions = [
    "organization.update",
    "memberships.manage",
    "programs.manage",
    "trainees.manage",
    "sessions.manage",
    "reports.compute",
    "certificates.issue",
    "integrations.manage",
  ] as const satisfies readonly Permission[];

  assert.ok(
    mutationPermissions.every(
      (permission) => !roleHasPermission("viewer", permission),
    ),
  );
  assert.equal(
    roleHasPermission("trainer", "memberships.manage"),
    false,
  );
  assert.equal(
    roleHasPermission("trainer", "integrations.manage"),
    false,
  );
});

test("organization access is constrained to the requested organization", () => {
  const subject = {
    isPlatformOwner: false,
    organizationRoles: {
      "org-a": "trainer",
      "org-b": "viewer",
    },
  } as const;

  assert.equal(canAccess(subject, "trainees.manage", "org-a"), true);
  assert.equal(canAccess(subject, "trainees.manage", "org-b"), false);
  assert.equal(canAccess(subject, "trainees.read", "org-b"), true);
  assert.equal(canAccess(subject, "trainees.read", "org-c"), false);
  assert.equal(canAccess(subject, "trainees.read"), false);
  assert.equal(canAccess(subject, "organizations.read"), false);
});

test("permission matrix matches the existing certificate and session contracts", () => {
  assert.equal(roleHasPermission("trainer", "certificates.issue"), true);
  assert.equal(roleHasPermission("trainer", "certificates.revoke"), false);
  assert.equal(roleHasPermission("viewer", "sessions.read"), false);
});

test("platform owner can cross tenant boundaries only through explicit permissions", () => {
  const subject = {
    isPlatformOwner: true,
    organizationRoles: {},
  } as const;

  assert.equal(canAccess(subject, "organizations.read"), true);
  assert.equal(canAccess(subject, "trainees.manage", "any-org"), true);
});

test("protected page map distinguishes platform, write, and read routes", () => {
  assert.equal(
    pagePermissionForPath("/platform/organizations"),
    "platform.dashboard.read",
  );
  assert.equal(pagePermissionForPath("/cohorts/abc/run"), "sessions.manage");
  assert.equal(pagePermissionForPath("/trainees/AMD-ABCDE"), "trainees.read");
  assert.equal(pagePermissionForPath("/account"), undefined);
  assert.equal(pagePermissionForPath("/verify/ABC"), undefined);
});

test("authentication redirects stay on the application origin", () => {
  assert.equal(safeInternalPath("/reports?tab=cohort"), "/reports?tab=cohort");
  assert.equal(safeInternalPath("//evil.example"), "/dashboard");
  assert.equal(safeInternalPath("/\\evil.example"), "/dashboard");
  assert.equal(safeInternalPath("/%5cevil.example"), "/dashboard");
  assert.equal(safeInternalPath("javascript:alert(1)"), "/dashboard");
});
