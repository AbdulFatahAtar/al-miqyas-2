import { CertificatesLivePage } from "../../components/certificates-live-page";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("certificates.read", {
    nextPath: "/certificates",
  });
  const organization = access.organizations.find(
    (item) => item.id === access.activeOrganizationId,
  );
  return (
    <CertificatesLivePage
      organizationId={access.activeOrganizationId}
      accessRole={organization?.role ?? "viewer"}
    />
  );
}
