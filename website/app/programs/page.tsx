import { ProgramsPage } from "../../components/programs-page";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("programs.read", {
    nextPath: "/programs",
  });
  const organization = access.organizations.find(
    (item) => item.id === access.activeOrganizationId,
  );

  return (
    <ProgramsPage
      organizationId={access.activeOrganizationId}
      accessRole={organization?.role ?? "viewer"}
    />
  );
}
