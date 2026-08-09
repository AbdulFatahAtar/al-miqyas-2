import { TraineeDetailsPage } from "../../../components/trainee-details-page";
import { canAccess } from "../../../lib/auth/permissions";
import { requireOrganizationPagePermission } from "../../../lib/auth/server";

export default async function TraineePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const access = await requireOrganizationPagePermission("trainees.read", {
    nextPath: `/trainees/${code}`,
  });
  return (
    <TraineeDetailsPage
      traineeCode={code.toUpperCase()}
      organizationId={access.activeOrganizationId}
      canReadContacts={canAccess(
        access.authorization,
        "trainees.manage",
        access.activeOrganizationId,
      )}
    />
  );
}
