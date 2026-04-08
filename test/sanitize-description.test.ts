import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseRssItems, summarizeDescription } from "../src/index.ts";

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

test("summarizeDescription falls back for markup-only content", () => {
  const summary = summarizeDescription(
    "<style>body{display:none}</style><!-- hidden --><script>console.log('x')</script>",
    "Anything",
  );

  assert.equal(summary, "New newsletter item");
});

test("summarizeDescription decodes entities and preserves unrelated leading text", () => {
  const summary = summarizeDescription(
    "Weekly recap: Miles &amp; smiles &#x1F3C3; &#39;all around&#39; &nbsp;<strong>today</strong>",
    "Oakland Marathon",
  );

  assert.equal(summary, "Weekly recap: Miles & smiles 🏃 'all around' today");
});

test("summarizeDescription trims duplicate title variants and truncates overlong text", () => {
  const summary = summarizeDescription(
    `<p>Oakland Marathon: ${"A".repeat(300)}</p>`,
    "Excelsior RC Newsletter: Oakland Marathon",
  );

  assert.equal(summary.length, 240);
  assert.ok(summary.endsWith("…"));
  assert.doesNotMatch(summary, /^Oakland Marathon\b/i);
});

test("parseRssItems extracts and summarizes feed entries", () => {
  const items = parseRssItems(`
    <rss>
      <channel>
        <item>
          <title><![CDATA[Excelsior RC Newsletter: Oakland Marathon]]></title>
          <link>https://example.com/oakland</link>
          <guid>oakland-1</guid>
          <description><![CDATA[<style>.x{color:red}</style><p>Oakland Marathon Great race recap &amp; results.</p>]]></description>
          <pubDate>Tue, 25 Mar 2026 10:30:00 GMT</pubDate>
        </item>
        <item>
          <title>Second item</title>
          <link>https://example.com/second</link>
          <description><![CDATA[<p>Second body</p>]]></description>
        </item>
      </channel>
    </rss>
  `);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    id: "oakland-1",
    title: "Excelsior RC Newsletter: Oakland Marathon",
    link: "https://example.com/oakland",
    description: "Great race recap & results.",
    pubDate: "Tue, 25 Mar 2026 10:30:00 GMT",
  });
  assert.equal(items[1]?.id, "https://example.com/second");
  assert.equal(items[1]?.description, "Second body");
});
