import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialogSource = readFileSync(
  new URL("../components/accessible-dialog.tsx", import.meta.url),
  "utf8",
);

test("AccessibleDialog exposes a labelled modal and a safe fallback focus target", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /aria-labelledby=\{labelledBy\}/);
  assert.match(dialogSource, /aria-describedby=\{describedBy\}/);
  assert.match(dialogSource, /tabIndex=\{-1\}/);
  assert.match(dialogSource, /button:not\(\[disabled\]\)/);
  assert.match(dialogSource, /\[tabindex\]:not\(\[tabindex='-1'\]\)/);
  assert.match(
    dialogSource,
    /requestAnimationFrame\([\s\S]+firstFocusable[\s\S]+\(firstFocusable \?\? dialog\)\?\.focus\(\)/,
  );
});

test("AccessibleDialog closes on Escape unless a destructive action has disabled closing", () => {
  assert.match(dialogSource, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(dialogSource, /event\.key === "Escape" && !disableClose/);
  assert.match(dialogSource, /event\.preventDefault\(\)[\s\S]+closeRef\.current\(\)/);
  assert.match(dialogSource, /closeRef\.current = onClose/);
  assert.match(dialogSource, /document\.removeEventListener\("keydown", handleKeyDown\)/);
});

test("AccessibleDialog traps forward and reverse Tab navigation", () => {
  assert.match(dialogSource, /if \(event\.key !== "Tab"\) return/);
  assert.match(dialogSource, /dialog\.querySelectorAll<HTMLElement>\(focusableSelector\)/);
  assert.match(
    dialogSource,
    /event\.shiftKey && document\.activeElement === first[\s\S]+last\.focus\(\)/,
  );
  assert.match(
    dialogSource,
    /!event\.shiftKey && document\.activeElement === last[\s\S]+first\.focus\(\)/,
  );
  assert.match(
    dialogSource,
    /if \(!focusable\.length\)[\s\S]+event\.preventDefault\(\)[\s\S]+dialog\.focus\(\)/,
  );
});

test("AccessibleDialog restores focus and document scrolling after unmount", () => {
  assert.match(dialogSource, /const previouslyFocused = document\.activeElement/);
  assert.match(dialogSource, /const previousOverflow = document\.body\.style\.overflow/);
  assert.match(dialogSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialogSource, /window\.cancelAnimationFrame\(frame\)/);
  assert.match(dialogSource, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(dialogSource, /previouslyFocused\?\.focus\(\)/);
});

test("AccessibleDialog closes only from the actual backdrop and respects disableClose", () => {
  assert.match(
    dialogSource,
    /if \(!disableClose && event\.target === event\.currentTarget\)/,
  );
  assert.match(dialogSource, /onMouseDown=\{closeFromBackdrop\}/);
  assert.match(dialogSource, /disableClose = false/);
});
