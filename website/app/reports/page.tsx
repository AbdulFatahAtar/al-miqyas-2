import { ReportsLivePage } from "../../components/reports-live-page";
import { canAccess } from "../../lib/auth/permissions";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("reports.read", {
    nextPath: "/reports",
  });
  const organizationId = access.activeOrganizationId;
  return (
    <ReportsLivePage
      organizationId={organizationId}
      canComputeReports={canAccess(
        access.authorization,
        "reports.compute",
        organizationId,
      )}
      canExportReports={canAccess(
        access.authorization,
        "reports.export",
        organizationId,
      )}
    />
  );
}
