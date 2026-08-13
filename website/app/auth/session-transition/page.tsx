import { AuthSessionTransition } from "../../../components/auth-session-transition";
import { safeInternalPath } from "../../../lib/auth/safe-redirect";

export default async function AuthSessionTransitionPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return <AuthSessionTransition nextPath={safeInternalPath(params.next)} />;
}
