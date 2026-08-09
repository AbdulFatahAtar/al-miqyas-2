import { CohortRoom } from "../../../../components/cohort-room";
import { requirePagePermission } from "../../../../lib/auth/server";
import { notFound, redirect } from "next/navigation";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function Page({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;

  if (!uuidPattern.test(cohortId)) {
    notFound();
  }

  const access = await requirePagePermission("sessions.read", {
    nextPath: `/cohorts/${cohortId}/run`,
  });

  if (!access.activeOrganizationId) {
    redirect(
      access.isPlatformOwner ? "/platform?notice=no-organization" : "/forbidden",
    );
  }

  return (
    <CohortRoom
      cohortId={cohortId}
      organizationId={access.activeOrganizationId}
    />
  );
}
