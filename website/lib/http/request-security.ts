const allowedFetchSites = new Set(["same-origin", "none"]);

export function isTrustedSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && !allowedFetchSites.has(fetchSite)) {
    return false;
  }

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
