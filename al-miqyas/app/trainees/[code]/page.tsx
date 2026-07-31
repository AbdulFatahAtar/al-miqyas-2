import { TraineeDetailsPage } from "../../../components/trainee-details-page";

export default async function TraineePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <TraineeDetailsPage traineeCode={code.toUpperCase()} />;
}
