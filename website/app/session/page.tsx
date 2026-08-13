import type { Metadata } from "next";
import { OperationalSessionJourneyPage } from "../../components/operational-session-journey-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "رحلة الجلسة | منظومة المقياس",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <OperationalSessionJourneyPage />;
}
