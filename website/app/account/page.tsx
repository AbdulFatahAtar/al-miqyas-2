import { AccountLivePage } from "../../components/account-live-page";
import { requireAuthenticatedUser } from "../../lib/auth/server";

export default async function Page() {
  await requireAuthenticatedUser("/account");
  return <AccountLivePage />;
}
