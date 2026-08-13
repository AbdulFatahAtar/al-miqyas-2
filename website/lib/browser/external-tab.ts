export function openExternalTabPlaceholder() {
  const externalTab = window.open("about:blank", "_blank");
  if (!externalTab) return null;

  externalTab.opener = null;
  externalTab.document.documentElement.lang = "ar";
  externalTab.document.documentElement.dir = "rtl";
  externalTab.document.title = "جارٍ فتح الرابط";
  externalTab.document.body.textContent = "جارٍ إنشاء الرابط الآمن...";
  return externalTab;
}

export function navigateExternalTab(externalTab: Window, rawUrl: string) {
  const targetUrl = new URL(rawUrl);
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    throw new Error("Unsupported external URL protocol.");
  }
  externalTab.location.replace(targetUrl.toString());
}
