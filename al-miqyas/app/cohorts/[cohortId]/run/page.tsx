import { CohortRoom } from "../../../../components/cohort-room";

export default async function Page({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  return <CohortRoom cohortId={cohortId} />;
}
