import { SettingsLivePage } from "../../components/settings-live-page";
import { canAccess } from "../../lib/auth/permissions";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("integrations.read", {
    nextPath: "/settings",
  });
  const organizationId = access.activeOrganizationId;
  const organization = access.organizations.find(
    (item) => item.id === organizationId,
  )!;

  return (
    <SettingsLivePage
      organization={organization}
      canManageIntegrations={canAccess(
        access.authorization,
        "integrations.manage",
        organizationId,
      )}
    />
  );
}
