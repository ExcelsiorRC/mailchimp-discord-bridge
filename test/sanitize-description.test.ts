import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarizeDescription } from "../src/index.ts";

test("summarizeDescription strips Mailchimp CSS and keeps newsletter copy", () => {
  const html = readFileSync(new URL("./fixtures/oakland-marathon.html", import.meta.url), "utf8");
  const summary = summarizeDescription(html, "Excelsior RC Newsletter: Oakland Marathon");

  assert.equal(
    summary,
    "Club runners tackled the Oakland Half Marathon on March 22nd and came away with a strong day on the course. The hills were challenging, the crowd support was loud, and the team energy carried through the entire race. This sample fixture ke…",
  );
  assert.ok(summary.length <= 240);
  assert.doesNotMatch(summary, /^Oakland Marathon\b/i);
  assert.doesNotMatch(summary, /#outlook|border-collapse|word-break|padding:0/i);
});
