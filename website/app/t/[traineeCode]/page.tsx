import { TraineeRoutingPage } from "../../../components/trainee-routing-page";

export default async function Page({ params }: { params: Promise<{ traineeCode: string }> }) {
  const { traineeCode } = await params;
  return <TraineeRoutingPage traineeCode={traineeCode.toUpperCase()} />;
}
