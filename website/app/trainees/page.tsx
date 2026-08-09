import { TraineesPage } from "../../components/trainees-page";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("trainees.read", {
    nextPath: "/trainees",
  });
  const organization = access.organizations.find(
    (item) => item.id === access.activeOrganizationId,
  );

  return (
    <TraineesPage
      organizationId={access.activeOrganizationId}
      accessRole={organization?.role ?? "viewer"}
    />
  );
}
