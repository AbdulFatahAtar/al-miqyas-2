export const roleKeys = [
  "platform_owner",
  "owner",
  "trainer",
  "viewer",
] as const;

export type RoleKey = (typeof roleKeys)[number];
export type OrganizationRole = Exclude<RoleKey, "platform_owner">;
export type PermissionScope = "platform" | "organization";

export const permissionDefinitions = [
  {
    key: "platform.dashboard.read",
    scope: "platform",
    label: "عرض لوحة المنصة",
  },
  {
    key: "organizations.read",
    scope: "platform",
    label: "عرض جميع الجهات",
  },
  {
    key: "organizations.create",
    scope: "platform",
    label: "إنشاء جهة",
  },
  {
    key: "organizations.update",
    scope: "platform",
    label: "تعديل بيانات جهة",
  },
  {
    key: "organizations.change_status",
    scope: "platform",
    label: "تعليق جهة أو أرشفتها أو استعادتها",
  },
  {
    key: "users.read",
    scope: "platform",
    label: "عرض مستخدمي المنصة",
  },
  {
    key: "users.create",
    scope: "platform",
    label: "إنشاء مستخدم أو دعوته",
  },
  {
    key: "users.update",
    scope: "platform",
    label: "تحديث بيانات وصول المستخدم",
  },
  {
    key: "users.suspend",
    scope: "platform",
    label: "تعليق وصول المستخدم",
  },
  {
    key: "memberships.manage_all",
    scope: "platform",
    label: "إدارة العضويات عبر الجهات",
  },
  {
    key: "roles.read",
    scope: "platform",
    label: "عرض مصفوفة الأدوار والصلاحيات",
  },
  {
    key: "roles.manage",
    scope: "platform",
    label: "إدارة إسناد الأدوار",
  },
  {
    key: "permissions.manage",
    scope: "platform",
    label: "إدارة إسناد الصلاحيات المعتمدة",
  },
  {
    key: "platform.settings.manage",
    scope: "platform",
    label: "إدارة إعدادات المنصة",
  },
  {
    key: "audit.read_all",
    scope: "platform",
    label: "عرض سجل التدقيق لكل الجهات",
  },
  {
    key: "organization.read",
    scope: "organization",
    label: "عرض الجهة",
  },
  {
    key: "organization.update",
    scope: "organization",
    label: "تعديل الجهة",
  },
  {
    key: "memberships.read",
    scope: "organization",
    label: "عرض عضويات الجهة",
  },
  {
    key: "memberships.manage",
    scope: "organization",
    label: "إدارة عضويات الجهة",
  },
  {
    key: "access_requests.review",
    scope: "organization",
    label: "مراجعة طلبات الوصول",
  },
  {
    key: "programs.read",
    scope: "organization",
    label: "عرض البرامج والدفعات",
  },
  {
    key: "programs.manage",
    scope: "organization",
    label: "إدارة البرامج والدفعات",
  },
  {
    key: "trainees.read",
    scope: "organization",
    label: "عرض المتدرّبين",
  },
  {
    key: "trainees.manage",
    scope: "organization",
    label: "إدارة المتدرّبين",
  },
  {
    key: "sessions.read",
    scope: "organization",
    label: "عرض الجلسات",
  },
  {
    key: "sessions.manage",
    scope: "organization",
    label: "تشغيل الجلسات وإدارتها",
  },
  {
    key: "assessments.read",
    scope: "organization",
    label: "عرض نتائج القياس",
  },
  {
    key: "reports.read",
    scope: "organization",
    label: "عرض التقارير",
  },
  {
    key: "reports.compute",
    scope: "organization",
    label: "حساب التقارير وتحديثها",
  },
  {
    key: "reports.export",
    scope: "organization",
    label: "تصدير التقارير",
  },
  {
    key: "certificates.read",
    scope: "organization",
    label: "عرض الشهادات",
  },
  {
    key: "certificates.issue",
    scope: "organization",
    label: "إصدار الشهادات",
  },
  {
    key: "certificates.revoke",
    scope: "organization",
    label: "إلغاء الشهادات",
  },
  {
    key: "certificates.reissue",
    scope: "organization",
    label: "إعادة إصدار الشهادات",
  },
  {
    key: "integrations.read",
    scope: "organization",
    label: "عرض حالة التكاملات",
  },
  {
    key: "integrations.manage",
    scope: "organization",
    label: "إدارة التكاملات والمفاتيح",
  },
  {
    key: "audit.read",
    scope: "organization",
    label: "عرض سجل تدقيق الجهة",
  },
] as const;

export type Permission = (typeof permissionDefinitions)[number]["key"];

const allPermissions = permissionDefinitions.map(
  (definition) => definition.key,
) as Permission[];

const ownerPermissions = permissionDefinitions
  .filter((definition) => definition.scope === "organization")
  .map((definition) => definition.key) as Permission[];

export const rolePermissionMatrix: Readonly<
  Record<RoleKey, readonly Permission[]>
> = {
  platform_owner: allPermissions,
  owner: ownerPermissions,
  trainer: [
    "organization.read",
    "memberships.read",
    "programs.read",
    "programs.manage",
    "trainees.read",
    "trainees.manage",
    "sessions.read",
    "sessions.manage",
    "assessments.read",
    "reports.read",
    "reports.compute",
    "reports.export",
    "certificates.read",
    "certificates.issue",
    "integrations.read",
  ],
  viewer: [
    "organization.read",
    "programs.read",
    "trainees.read",
    "reports.read",
    "certificates.read",
  ],
};

export const roleLabels: Record<RoleKey, string> = {
  platform_owner: "مالك المنصة",
  owner: "مالك الجهة",
  trainer: "مدرّب",
  viewer: "قارئ",
};

export function isPermission(value: string): value is Permission {
  return permissionDefinitions.some(
    (definition) => definition.key === value,
  );
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return value === "owner" || value === "trainer" || value === "viewer";
}

export function roleHasPermission(
  role: RoleKey,
  permission: Permission,
) {
  return rolePermissionMatrix[role].includes(permission);
}

export function permissionScope(permission: Permission): PermissionScope {
  return permissionDefinitions.find(
    (definition) => definition.key === permission,
  )!.scope;
}

export type AuthorizationSubject = {
  isPlatformOwner: boolean;
  organizationRoles: Readonly<Record<string, OrganizationRole>>;
};

export function canAccess(
  subject: AuthorizationSubject,
  permission: Permission,
  organizationId?: string,
) {
  if (
    subject.isPlatformOwner &&
    roleHasPermission("platform_owner", permission)
  ) {
    return true;
  }

  if (permissionScope(permission) === "platform") {
    return false;
  }

  if (organizationId) {
    const role = subject.organizationRoles[organizationId];
    return role ? roleHasPermission(role, permission) : false;
  }

  return false;
}

const protectedPagePermissions: ReadonlyArray<{
  prefix: string;
  permission: Permission;
}> = [
  { prefix: "/platform", permission: "platform.dashboard.read" },
  { prefix: "/cohorts", permission: "sessions.manage" },
  { prefix: "/programs", permission: "programs.read" },
  { prefix: "/trainees", permission: "trainees.read" },
  { prefix: "/sessions", permission: "sessions.read" },
  { prefix: "/reports", permission: "reports.read" },
  { prefix: "/certificates", permission: "certificates.read" },
  { prefix: "/organizations", permission: "memberships.read" },
  { prefix: "/settings", permission: "integrations.read" },
  { prefix: "/dashboard", permission: "organization.read" },
];

export function pagePermissionForPath(pathname: string) {
  return protectedPagePermissions.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )?.permission;
}
