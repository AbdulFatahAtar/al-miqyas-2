import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  THEME_DARK_QUERY,
  THEME_STORAGE_KEY,
  themeBootstrapScript,
} from "../lib/theme.ts";

const providerSource = readFileSync(
  new URL("../components/theme-provider.tsx", import.meta.url),
  "utf8",
);
const toggleSource = readFileSync(
  new URL("../components/theme-toggle.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

type BootstrapOptions = {
  stored?: string | null;
  systemDark?: boolean;
  storageThrows?: boolean;
  mediaThrows?: boolean;
};

function executeBootstrap({
  stored = null,
  systemDark = false,
  storageThrows = false,
  mediaThrows = false,
}: BootstrapOptions = {}) {
  const root = {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const context = {
    document: { documentElement: root },
    localStorage: {
      getItem(key: string) {
        assert.equal(key, THEME_STORAGE_KEY);
        if (storageThrows) throw new Error("storage blocked");
        return stored;
      },
    },
    matchMedia(query: string) {
      assert.equal(query, THEME_DARK_QUERY);
      if (mediaThrows) throw new Error("media query blocked");
      return { matches: systemDark };
    },
  };

  vm.runInNewContext(themeBootstrapScript, context);
  return root;
}

function cssSection(start: string, end: string) {
  const startIndex = globalCss.indexOf(start);
  const endIndex = globalCss.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing CSS section: ${start}`);
  assert.notEqual(endIndex, -1, `missing CSS section end: ${end}`);
  return globalCss.slice(startIndex, endIndex);
}

test("theme bootstrap applies stored light and dark choices before React", () => {
  for (const preference of ["light", "dark"] as const) {
    const root = executeBootstrap({ stored: preference, systemDark: preference === "dark" });
    assert.deepEqual(
      { ...root.dataset },
      { theme: preference, themePreference: preference },
    );
    assert.equal(root.style.colorScheme, preference);
  }
});

test("theme bootstrap resolves System from the media query while preserving the preference", () => {
  const darkRoot = executeBootstrap({ stored: "system", systemDark: true });
  assert.deepEqual(
    { ...darkRoot.dataset },
    { theme: "dark", themePreference: "system" },
  );
  assert.equal(darkRoot.style.colorScheme, "dark");

  const lightRoot = executeBootstrap({ stored: "system", systemDark: false });
  assert.deepEqual(
    { ...lightRoot.dataset },
    { theme: "light", themePreference: "system" },
  );
  assert.equal(lightRoot.style.colorScheme, "light");
});

test("theme bootstrap fails safely when storage or media APIs are unavailable", () => {
  const invalidStored = executeBootstrap({ stored: "sepia", systemDark: true });
  assert.deepEqual(
    { ...invalidStored.dataset },
    { theme: "dark", themePreference: "system" },
  );

  const blocked = executeBootstrap({ storageThrows: true, mediaThrows: true });
  assert.deepEqual(
    { ...blocked.dataset },
    { theme: "light", themePreference: "system" },
  );
  assert.equal(blocked.style.colorScheme, "light");
});

test("root layout installs the bootstrap ahead of the client provider", () => {
  assert.match(layoutSource, /<html[^>]+lang="ar"[^>]+dir="rtl"/);
  assert.match(layoutSource, /data-theme="light"/);
  assert.match(layoutSource, /suppressHydrationWarning/);
  assert.match(layoutSource, /id="miqyas-theme-bootstrap"/);
  assert.match(
    layoutSource,
    /dangerouslySetInnerHTML=\{\{ __html: themeBootstrapScript \}\}/,
  );
  assert.ok(
    layoutSource.indexOf("miqyas-theme-bootstrap") <
      layoutSource.indexOf("<ThemeProvider>"),
  );
});

test("ThemeProvider persists explicit choices and follows System changes", () => {
  assert.match(providerSource, /ThemePreference = "light" \| "dark" \| "system"/);
  assert.match(providerSource, /window\.localStorage\.getItem\(THEME_STORAGE_KEY\)/);
  assert.match(
    providerSource,
    /window\.localStorage\.setItem\(THEME_STORAGE_KEY, nextPreference\)/,
  );
  assert.match(providerSource, /root\.dataset\.theme = resolvedTheme/);
  assert.match(providerSource, /root\.dataset\.themePreference = preference/);
  assert.match(providerSource, /root\.style\.colorScheme = resolvedTheme/);
  assert.match(providerSource, /window\.matchMedia\(THEME_DARK_QUERY\)/);
  assert.match(providerSource, /mediaQuery\.addEventListener\("change", syncSystemTheme\)/);
  assert.match(providerSource, /mediaQuery\.removeEventListener\("change", syncSystemTheme\)/);
  assert.match(providerSource, /preference !== "system"/);
});

test("theme switch exposes Light, Dark, and System as an accessible exclusive choice", () => {
  for (const value of ["light", "dark", "system"]) {
    assert.match(toggleSource, new RegExp(`value: "${value}"`));
  }
  assert.match(toggleSource, /role="group"/);
  assert.match(toggleSource, /aria-label="مظهر الموقع"/);
  assert.match(toggleSource, /aria-pressed=\{preference === option\.value\}/);
  assert.match(toggleSource, /setPreference\(option\.value\)/);
});

test("light and dark modes define complete semantic color tokens", () => {
  const light = cssSection(":root,\n[data-theme=\"light\"]", "[data-theme=\"dark\"]");
  const dark = cssSection("[data-theme=\"dark\"]", "* { box-sizing: border-box; }");
  const modeTokens = [
    "color-scheme",
    "bg-canvas",
    "bg-sidebar",
    "bg-surface",
    "bg-raised",
    "bg-soft",
    "bg-hover",
    "bg-selected",
    "border-subtle",
    "border-strong",
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "accent-system",
    "state-success",
    "state-warning",
    "state-danger",
    "state-info",
    "text-inverse",
    "text-link",
    "bg-disabled",
    "topbar-bg",
    "overlay-scrim",
    "shadow-floating",
    "shadow-raised",
    "chart-gridline",
    "focus-ring",
    "selection-bg",
    "select-chevron",
  ];

  for (const token of modeTokens) {
    assert.match(light, new RegExp(`--${token}:`), `light is missing --${token}`);
    assert.match(dark, new RegExp(`--${token}:`), `dark is missing --${token}`);
  }

  for (let series = 1; series <= 8; series += 1) {
    assert.match(light, new RegExp(`--chart-series-${series}:`));
    assert.match(dark, new RegExp(`--chart-series-${series}:`));
  }
  assert.match(globalCss, /html \{[^}]+color-scheme: var\(--color-scheme\)/);
});
