import type { Metadata } from "next";
import { OperationalSessionJoinPage } from "../../../components/operational-session-join-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الالتحاق بالجلسة | منظومة المقياس",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OperationalSessionJoinPage token={token} />;
}
