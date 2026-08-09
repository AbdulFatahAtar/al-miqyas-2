import { SessionsLivePage } from "../../components/sessions-live-page";
import { requireOrganizationPagePermission } from "../../lib/auth/server";

export default async function Page() {
  const access = await requireOrganizationPagePermission("sessions.read", {
    nextPath: "/sessions",
  });
  return <SessionsLivePage organizationId={access.activeOrganizationId} />;
}
