import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = resolve(PROJECT_ROOT, "app");
const DESIGN_FILE = resolve(
  PROJECT_ROOT,
  "../project-resources/design/references/DESIGN.md",
);
const APP_SHELL_FILE = resolve(PROJECT_ROOT, "components/app-shell.tsx");
const GLOBAL_CSS_FILE = resolve(PROJECT_ROOT, "app/globals.css");
const LEGACY_GLOBAL_CSS_FILE = resolve(PROJECT_ROOT, "app/globals 2.css");
const THEME_PROVIDER_FILE = resolve(
  PROJECT_ROOT,
  "components/theme-provider.tsx",
);
const THEME_TOGGLE_FILE = resolve(PROJECT_ROOT, "components/theme-toggle.tsx");
const THEME_LIBRARY_FILE = resolve(PROJECT_ROOT, "lib/theme.ts");

const TRAVERSABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css"];

type ImportRecord = {
  importedNames: string[];
  specifier: string;
};

type GraphEdge = ImportRecord & {
  importer: string;
  resolved: string | null;
};

type ActiveGraph = {
  edges: GraphEdge[];
  files: Set<string>;
};

function projectPath(filePath: string) {
  return relative(PROJECT_ROOT, filePath).split(sep).join("/");
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: Dirent) => {
      const child = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(child) : [child];
    },
  );
}

function scriptKind(filePath: string) {
  switch (extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function moduleSpecifierText(
  moduleSpecifier: ts.Expression | undefined,
): string | null {
  return moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)
    ? moduleSpecifier.text
    : null;
}

function importedNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause) return [];

  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);

  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
      if (element.name.text !== element.propertyName?.text) {
        names.push(element.name.text);
      }
    }
  } else if (bindings && ts.isNamespaceImport(bindings)) {
    names.push(bindings.name.text);
  }

  return names;
}

function sourceImports(filePath: string): ImportRecord[] {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const imports: ImportRecord[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const specifier = moduleSpecifierText(node.moduleSpecifier);
      if (specifier) {
        imports.push({ specifier, importedNames: importedNames(node) });
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier = moduleSpecifierText(node.moduleSpecifier);
      if (specifier) {
        const names = node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.flatMap((element) => [
              element.propertyName?.text ?? element.name.text,
              element.name.text,
            ])
          : [];
        imports.push({ specifier, importedNames: names });
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = moduleSpecifierText(node.arguments[0]);
      if (specifier) imports.push({ specifier, importedNames: [] });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function resolveLocalImport(importer: string, specifier: string) {
  if (!specifier.startsWith(".")) return null;

  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const unresolved = resolve(dirname(importer), cleanSpecifier);
  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        ...RESOLUTION_EXTENSIONS.map((extension) => `${unresolved}${extension}`),
        ...RESOLUTION_EXTENSIONS.map((extension) =>
          resolve(unresolved, `index${extension}`),
        ),
      ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function buildActiveRouteGraph(): ActiveGraph {
  const entries = walk(APP_ROOT).filter((filePath) => filePath.endsWith(".tsx"));
  assert.ok(entries.length > 0, "the App Router has no TSX route entries");

  const queue = [...entries];
  const files = new Set<string>();
  const edges: GraphEdge[] = [];

  while (queue.length) {
    const filePath = queue.shift();
    if (!filePath || files.has(filePath)) continue;

    files.add(filePath);
    if (extname(filePath) === ".css") continue;

    for (const imported of sourceImports(filePath)) {
      const resolved = resolveLocalImport(filePath, imported.specifier);
      edges.push({ importer: filePath, resolved, ...imported });

      if (
        resolved &&
        resolved.startsWith(`${PROJECT_ROOT}${sep}`) &&
        TRAVERSABLE_EXTENSIONS.has(extname(resolved)) &&
        !files.has(resolved)
      ) {
        queue.push(resolved);
      }
    }
  }

  return { edges, files };
}

const activeGraph = buildActiveRouteGraph();

function cssValueInPixels(value: string): number | null {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  return match[2].toLowerCase() === "rem" ? amount * 16 : amount;
}

function lineNumber(source: string, offset: number) {
  return source.slice(0, offset).split("\n").length;
}

test("the active AppShell implements the Ledger Masthead and Section Index", () => {
  assert.ok(
    activeGraph.files.has(APP_SHELL_FILE),
    "active App Router pages must reach components/app-shell.tsx",
  );

  const source = readFileSync(APP_SHELL_FILE, "utf8");
  const sourceFile = ts.createSourceFile(
    APP_SHELL_FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let ledgerMasthead = false;
  let sectionIndex = false;
  const legacyClassReferences: string[] = [];

  function inspectJsx(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      const classAttribute = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className",
      );
      const classValue = classAttribute?.initializer?.getText(sourceFile) ?? "";

      if (tag === "header" && /\bstyles\.masthead\b/.test(classValue)) {
        ledgerMasthead = true;
      }
      if (tag === "aside" && /\bstyles\.sectionIndex\b/.test(classValue)) {
        sectionIndex = true;
      }
      if (/\b(?:sidebar|topbar)\b/i.test(classValue)) {
        legacyClassReferences.push(classValue);
      }
    }

    ts.forEachChild(node, inspectJsx);
  }

  inspectJsx(sourceFile);

  assert.equal(ledgerMasthead, true, "AppShell is missing its semantic Ledger Masthead");
  assert.match(source, />\s*سجل الإتقان\s*</);
  assert.equal(sectionIndex, true, "AppShell is missing its semantic Section Index");
  assert.match(source, /id="section-index"/);
  assert.match(source, /aria-label="فهرس سجل الإتقان"/);
  assert.deepEqual(
    legacyClassReferences,
    [],
    "AppShell JSX must not reconstruct the old sidebar/topbar layout",
  );
});

test("typography tokens match the six-size scale required by DESIGN.md", () => {
  const design = readFileSync(DESIGN_FILE, "utf8");
  const css = readFileSync(GLOBAL_CSS_FILE, "utf8");
  const expectedScale = [
    ["--text-xs", 12],
    ["--text-sm", 14],
    ["--text-md", 16],
    ["--text-lg", 19],
    ["--text-xl", 23],
    ["--text-2xl", 33],
  ] as const;

  let previousDesignOffset = -1;
  for (const [token, expectedPixels] of expectedScale) {
    const designPattern = new RegExp(`\\|\\s*${expectedPixels}px\\s*\\|`, "g");
    designPattern.lastIndex = previousDesignOffset + 1;
    const documented = designPattern.exec(design);
    assert.ok(
      documented,
      `DESIGN.md is missing ${expectedPixels}px from the ordered typography scale`,
    );
    previousDesignOffset = documented.index;

    const tokenPattern = new RegExp(
      `${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`,
    );
    const declaration = css.match(tokenPattern);
    assert.ok(declaration, `app/globals.css is missing ${token}`);
    assert.equal(
      cssValueInPixels(declaration[1]),
      expectedPixels,
      `${token} must resolve to ${expectedPixels}px`,
    );
  }
});

test("every stylesheet imported by an active route keeps text at 12px or larger", () => {
  const activeCssFiles = [...activeGraph.files]
    .filter((filePath) => filePath.endsWith(".css"))
    .sort();

  assert.ok(activeCssFiles.includes(GLOBAL_CSS_FILE));
  assert.equal(
    activeCssFiles.includes(LEGACY_GLOBAL_CSS_FILE),
    false,
    "the retired app/globals 2.css must stay outside the active route graph",
  );

  const violations: string[] = [];
  const declarationPattern = /(?:^|[;{])\s*(font-size|font)\s*:\s*([^;}]+)/gim;
  const numericSizePattern = /(-?(?:\d+\.?\d*|\.\d+))(px|rem)\b/gi;

  for (const filePath of activeCssFiles) {
    const source = readFileSync(filePath, "utf8");

    for (const declaration of source.matchAll(declarationPattern)) {
      const property = declaration[1].toLowerCase();
      const value = declaration[2].trim();
      numericSizePattern.lastIndex = 0;

      for (const size of value.matchAll(numericSizePattern)) {
        const pixels = cssValueInPixels(`${size[1]}${size[2]}`);
        if (pixels !== null && pixels < 12) {
          violations.push(
            `${projectPath(filePath)}:${lineNumber(source, declaration.index ?? 0)} ` +
              `${property}: ${value} resolves below 12px`,
          );
        }
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("the active route graph cannot reach demo or retired page modules", () => {
  const forbiddenModules =
    /(?:^|\/)(?:demo-data|dashboard-pages|trainee-workspace(?: 2)?)(?:\.[^/]*)?$/;
  const violations: string[] = [];

  for (const edge of activeGraph.edges) {
    if (forbiddenModules.test(edge.specifier)) {
      violations.push(
        `${projectPath(edge.importer)} imports retired module ${edge.specifier}`,
      );
    }
    if (edge.importedNames.includes("DemoNotice")) {
      violations.push(
        `${projectPath(edge.importer)} imports the retired DemoNotice symbol from ${edge.specifier}`,
      );
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("Light, Dark, and System are all wired into the active theme contract", () => {
  for (const filePath of [
    THEME_PROVIDER_FILE,
    THEME_TOGGLE_FILE,
    THEME_LIBRARY_FILE,
  ]) {
    assert.ok(
      activeGraph.files.has(filePath),
      `${projectPath(filePath)} must be reachable from an active route`,
    );
  }

  const provider = readFileSync(THEME_PROVIDER_FILE, "utf8");
  const toggle = readFileSync(THEME_TOGGLE_FILE, "utf8");
  const themeLibrary = readFileSync(THEME_LIBRARY_FILE, "utf8");
  const css = readFileSync(GLOBAL_CSS_FILE, "utf8");

  assert.match(provider, /ThemePreference\s*=\s*"light"\s*\|\s*"dark"\s*\|\s*"system"/);
  for (const preference of ["light", "dark", "system"]) {
    assert.match(toggle, new RegExp(`value:\\s*"${preference}"`));
  }
  assert.match(themeLibrary, /preference\s*=\s*"system"/);
  assert.match(themeLibrary, /prefers-color-scheme:\s*dark/);
  assert.match(css, /\[data-theme="light"\]/);
  assert.match(css, /\[data-theme="dark"\]/);
});
