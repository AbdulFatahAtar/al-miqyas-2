import { DashboardLivePage } from "../../components/dashboard-live-page";
import { canAccess } from "../../lib/auth/permissions";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("organization.read", {
    nextPath: "/dashboard",
  });

  return (
    <DashboardLivePage
      organizationId={access.activeOrganizationId}
      canManageTrainees={canAccess(
        access.authorization,
        "trainees.manage",
        access.activeOrganizationId,
      )}
    />
  );
}
