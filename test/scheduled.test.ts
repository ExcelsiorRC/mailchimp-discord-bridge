import test from "node:test";
import assert from "node:assert/strict";

import { handleScheduled } from "../src/index.ts";

class MemoryKV {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function createEnv(kv: MemoryKV) {
  return {
    DISCORD_WEBHOOK_URL: "https://discord.test/webhook",
    MAILCHIMP_RSS_URL: "https://feed.test/rss",
    NEWSLETTER_STATE: kv as unknown as KVNamespace,
  };
}

function createFeedXml(items: Array<{ id: string; title: string; link: string; description: string; pubDate?: string }>) {
  return `
    <rss>
      <channel>
        ${items
          .map(
            (item) => `
              <item>
                <title><![CDATA[${item.title}]]></title>
                <link>${item.link}</link>
                <guid>${item.id}</guid>
                <description><![CDATA[${item.description}]]></description>
                ${item.pubDate ? `<pubDate>${item.pubDate}</pubDate>` : ""}
              </item>
            `,
          )
          .join("")}
      </channel>
    </rss>
  `;
}

function installFetchMock(feedXml: string) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });

    if (url === "https://feed.test/rss") {
      return new Response(feedXml, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      });
    }

    if (url === "https://discord.test/webhook") {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("handleScheduled initializes the cursor without posting on first run", async () => {
  const kv = new MemoryKV();
  const feedXml = createFeedXml([
    {
      id: "item-2",
      title: "Excelsior RC Newsletter: Newest",
      link: "https://example.com/newest",
      description: "<p>Latest body</p>",
    },
  ]);
  const mock = installFetchMock(feedXml);

  try {
    await handleScheduled(createEnv(kv));

    assert.equal(await kv.get("last_seen_item_id"), "item-2");
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0]?.url, "https://feed.test/rss");
  } finally {
    mock.restore();
  }
});

test("handleScheduled posts new items oldest-to-newest and advances the cursor", async () => {
  const kv = new MemoryKV();
  await kv.put("last_seen_item_id", "item-1");

  const feedXml = createFeedXml([
    {
      id: "item-3",
      title: "Third title",
      link: "https://example.com/third",
      description: "<p>Third body</p>",
      pubDate: "Wed, 01 Apr 2026 10:00:00 GMT",
    },
    {
      id: "item-2",
      title: "Second title",
      link: "https://example.com/second",
      description: "<p>Second body</p>",
      pubDate: "Tue, 31 Mar 2026 10:00:00 GMT",
    },
    {
      id: "item-1",
      title: "First title",
      link: "https://example.com/first",
      description: "<p>First body</p>",
      pubDate: "Mon, 30 Mar 2026 10:00:00 GMT",
    },
  ]);
  const mock = installFetchMock(feedXml);

  try {
    await handleScheduled(createEnv(kv));

    const discordBodies = mock.calls
      .filter((call) => call.url === "https://discord.test/webhook")
      .map((call) => JSON.parse(call.init?.body as string));

    assert.equal(discordBodies.length, 2);
    assert.equal(discordBodies[0]?.embeds?.[0]?.title, "Second title");
    assert.equal(discordBodies[1]?.embeds?.[0]?.title, "Third title");
    assert.equal(discordBodies[0]?.embeds?.[0]?.description, "Second body");
    assert.equal(discordBodies[1]?.embeds?.[0]?.description, "Third body");
    assert.equal(await kv.get("last_seen_item_id"), "item-3");
  } finally {
    mock.restore();
  }
});

test("handleScheduled does not post when the latest item is unchanged", async () => {
  const kv = new MemoryKV();
  await kv.put("last_seen_item_id", "item-2");

  const feedXml = createFeedXml([
    {
      id: "item-2",
      title: "Current title",
      link: "https://example.com/current",
      description: "<p>Current body</p>",
    },
  ]);
  const mock = installFetchMock(feedXml);

  try {
    await handleScheduled(createEnv(kv));

    assert.equal(mock.calls.length, 1);
    assert.equal(await kv.get("last_seen_item_id"), "item-2");
  } finally {
    mock.restore();
  }
});

test("handleScheduled advances the cursor without backfill when the stored item is missing", async () => {
  const kv = new MemoryKV();
  await kv.put("last_seen_item_id", "missing-item");

  const feedXml = createFeedXml([
    {
      id: "item-5",
      title: "Newest title",
      link: "https://example.com/newest",
      description: "<p>Newest body</p>",
    },
    {
      id: "item-4",
      title: "Older title",
      link: "https://example.com/older",
      description: "<p>Older body</p>",
    },
  ]);
  const mock = installFetchMock(feedXml);

  try {
    await handleScheduled(createEnv(kv));

    assert.equal(mock.calls.length, 1);
    assert.equal(await kv.get("last_seen_item_id"), "item-5");
  } finally {
    mock.restore();
  }
});
