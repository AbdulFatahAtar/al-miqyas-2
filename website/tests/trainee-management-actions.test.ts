import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const traineesPage = readFileSync(
  new URL("../components/trainees-page.tsx", import.meta.url),
  "utf8",
);

test("trainee managers can open registration when the registry already contains trainees", () => {
  assert.match(
    traineesPage,
    /canManage && cohorts\.length > 0[\s\S]+openCreateModal/,
  );
  assert.match(traineesPage, />\s*تسجيل متدرّب\s*</);
});
