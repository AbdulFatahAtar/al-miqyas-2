import type { Metadata } from "next";
import { VerificationLookupPage } from "../../components/verification-lookup-page";

export const metadata: Metadata = {
  title: "التحقق من شهادة | منظومة المقياس",
  description: "التحقق العام من صلاحية شهادة صادرة عبر منظومة المقياس",
};

export default function Page() {
  return <VerificationLookupPage />;
}
