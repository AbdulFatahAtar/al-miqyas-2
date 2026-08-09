export const THEME_STORAGE_KEY = "miqyas-theme";
export const THEME_DARK_QUERY = "(prefers-color-scheme: dark)";

export const themeBootstrapScript = `
(() => {
  const root = document.documentElement;
  let preference = "system";

  try {
    const stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    if (stored === "light" || stored === "dark" || stored === "system") {
      preference = stored;
    }
  } catch {}

  let resolved = preference === "dark" ? "dark" : "light";
  if (preference === "system") {
    try {
      resolved = matchMedia("${THEME_DARK_QUERY}").matches ? "dark" : "light";
    } catch {}
  }

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
})();
`;
