import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "../supabase/server";
import { ACTIVE_ORGANIZATION_COOKIE } from "./active-organization";
import {
  canAccess,
  isOrganizationRole,
  type AuthorizationSubject,
  type OrganizationRole,
  type Permission,
  type RoleKey,
  permissionScope,
} from "./permissions";

type MembershipRow = {
  org_id: string;
  role: string;
  status: string;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string | null;
  logo_url: string | null;
  brand_color: string;
  status: "active" | "suspended" | "archived";
};

export type AccessOrganization = OrganizationRow & {
  role: RoleKey;
};

export type CurrentAccessContext = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
  } | null;
  isPlatformOwner: boolean;
  organizations: AccessOrganization[];
  activeOrganizationId: string | null;
  authorization: AuthorizationSubject;
  loadError: boolean;
};

const anonymousContext: CurrentAccessContext = {
  user: null,
  isPlatformOwner: false,
  organizations: [],
  activeOrganizationId: null,
  authorization: {
    isPlatformOwner: false,
    organizationRoles: {},
  },
  loadError: false,
};

function userDisplayName(metadata: Record<string, unknown> | undefined) {
  const fullName = metadata?.full_name;
  return typeof fullName === "string" && fullName.trim()
    ? fullName.trim()
    : "مستخدم المنظومة";
}

export async function getCurrentAccessContext(): Promise<CurrentAccessContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return anonymousContext;
  }

  const [platformResult, membershipResult] = await Promise.all([
    supabase.rpc("is_platform_admin"),
    supabase
      .from("memberships")
      .select("org_id, role, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  const isPlatformOwner = platformResult.data === true;
  const memberships = ((membershipResult.data ?? []) as MembershipRow[]).filter(
    (membership) => isOrganizationRole(membership.role),
  );
  const membershipRoles = Object.fromEntries(
    memberships.map((membership) => [
      membership.org_id,
      membership.role as OrganizationRole,
    ]),
  );
  const organizationIds = memberships.map((membership) => membership.org_id);

  let organizationQuery = supabase
    .from("organizations")
    .select("id, slug, name_ar, name_en, logo_url, brand_color, status")
    .order("created_at", { ascending: true });

  if (!isPlatformOwner) {
    if (!organizationIds.length) {
      return {
        user: {
          id: user.id,
          email: user.email ?? null,
          displayName: userDisplayName(user.user_metadata),
        },
        isPlatformOwner,
        organizations: [],
        activeOrganizationId: null,
        authorization: {
          isPlatformOwner,
          organizationRoles: {},
        },
        loadError:
          Boolean(platformResult.error) || Boolean(membershipResult.error),
      };
    }

    organizationQuery = organizationQuery.in("id", organizationIds);
  }

  const organizationResult = await organizationQuery;
  const organizations = ((organizationResult.data ?? []) as OrganizationRow[])
    .map((organization) => ({
      ...organization,
      role: isPlatformOwner
        ? ("platform_owner" as const)
        : membershipRoles[organization.id],
    }))
    .filter(
      (organization): organization is AccessOrganization =>
        Boolean(organization.role),
    );

  const authorizedOrganizations = isPlatformOwner
    ? organizations
    : organizations.filter(
        (organization) => organization.status === "active",
      );
  const organizationRoles = Object.fromEntries(
    authorizedOrganizations
      .filter((organization) => organization.role !== "platform_owner")
      .map((organization) => [organization.id, organization.role]),
  ) as Record<string, OrganizationRole>;
  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get(
    ACTIVE_ORGANIZATION_COOKIE,
  )?.value;
  const activeOrganizationId =
    authorizedOrganizations.find(
      (organization) => organization.id === requestedOrganizationId,
    )?.id ?? authorizedOrganizations[0]?.id ?? null;

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      displayName: userDisplayName(user.user_metadata),
    },
    isPlatformOwner,
    organizations,
    activeOrganizationId,
    authorization: {
      isPlatformOwner,
      organizationRoles,
    },
    loadError:
      Boolean(platformResult.error) ||
      Boolean(membershipResult.error) ||
      Boolean(organizationResult.error),
  };
}

export async function requireAuthenticatedUser(nextPath = "/dashboard") {
  const context = await getCurrentAccessContext();

  if (!context.user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return context;
}

export async function requirePagePermission(
  permission: Permission,
  options: {
    organizationId?: string;
    nextPath?: string;
  } = {},
) {
  const context = await requireAuthenticatedUser(options.nextPath);
  const scope = permissionScope(permission);
  const resolvedOrganizationId =
    options.organizationId ??
    (scope === "organization"
      ? context.activeOrganizationId ?? undefined
      : undefined);

  if (scope === "organization" && !resolvedOrganizationId) {
    if (context.isPlatformOwner) {
      redirect("/platform");
    }

    const from = options.nextPath
      ? `?from=${encodeURIComponent(options.nextPath)}`
      : "";
    redirect(`/forbidden${from}`);
  }

  if (
    context.loadError ||
    !canAccess(
      context.authorization,
      permission,
      resolvedOrganizationId,
    )
  ) {
    const from = options.nextPath
      ? `?from=${encodeURIComponent(options.nextPath)}`
      : "";
    redirect(`/forbidden${from}`);
  }

  return context;
}

export async function requireOrganizationPagePermission(
  permission: Permission,
  options: {
    organizationId?: string;
    nextPath?: string;
  } = {},
) {
  if (permissionScope(permission) !== "organization") {
    throw new Error("Organization page guard requires an organization permission");
  }

  const context = await requirePagePermission(permission, options);
  const activeOrganizationId =
    options.organizationId ?? context.activeOrganizationId;

  if (!activeOrganizationId) {
    redirect(context.isPlatformOwner ? "/platform" : "/forbidden");
  }

  return { ...context, activeOrganizationId };
}
