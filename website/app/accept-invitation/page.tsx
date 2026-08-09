import { AcceptInvitationPage } from "../../components/accept-invitation-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; token?: string }>;
}) {
  const params = await searchParams;

  return (
    <AcceptInvitationPage
      requestId={params.request ?? ""}
      token={params.token ?? ""}
    />
  );
}

