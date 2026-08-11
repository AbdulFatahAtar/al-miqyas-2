import { LoginPage } from "../../components/auth-pages";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  return (
    <LoginPage
      nextPath={next}
      passwordUpdated={reset === "success"}
      authLinkFailed={error === "auth_callback"}
    />
  );
}
