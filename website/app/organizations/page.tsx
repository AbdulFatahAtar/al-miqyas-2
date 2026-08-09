import { OrganizationsPage } from "../../components/organizations-page";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  await requireOrganizationPagePermission("memberships.read", {
    nextPath: "/organizations",
  });
  return <OrganizationsPage />;
}
