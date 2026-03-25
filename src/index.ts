interface Env {
  DISCORD_WEBHOOK_URL: string;
  MAILCHIMP_RSS_URL: string;
  NEWSLETTER_STATE: KVNamespace;
}

interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate?: string;
}

const LAST_SEEN_KEY = "last_seen_item_id";
const FOOTER_TEXT = "Excelsior Running Club";
const MAX_DESCRIPTION_LENGTH = 240;

export default {
  async fetch(): Promise<Response> {
    return new Response("OK", { status: 200 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};

async function handleScheduled(env: Env): Promise<void> {
  const items = await fetchFeedItems(env.MAILCHIMP_RSS_URL);

  if (items.length === 0) {
    console.log("No items found in feed");
    return;
  }

  const latestItem = items[0];
  const lastSeenId = await env.NEWSLETTER_STATE.get(LAST_SEEN_KEY);

  if (!lastSeenId) {
    await env.NEWSLETTER_STATE.put(LAST_SEEN_KEY, latestItem.id);
    console.log("Initialized last seen item without posting");
    return;
  }

  if (lastSeenId === latestItem.id) {
    console.log("No new items");
    return;
  }

  const newItems: FeedItem[] = [];

  for (const item of items) {
    if (item.id === lastSeenId) {
      break;
    }
    newItems.push(item);
  }

  if (newItems.length === 0) {
    await env.NEWSLETTER_STATE.put(LAST_SEEN_KEY, latestItem.id);
    console.log("Last seen item missing from current feed, advanced cursor without posting");
    return;
  }

  for (const item of [...newItems].reverse()) {
    await postToDiscord(env.DISCORD_WEBHOOK_URL, item);
  }

  await env.NEWSLETTER_STATE.put(LAST_SEEN_KEY, latestItem.id);
  console.log(`Posted ${newItems.length} new item(s)`);
}

async function fetchFeedItems(feedUrl: string): Promise<FeedItem[]> {
  const response = await fetch(feedUrl, {
    headers: {
      "user-agent": "excelsior-mailchimp-discord-bridge/1.0",
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Feed request failed with status ${response.status}`);
  }

  const xml = await response.text();
  return parseRssItems(xml);
}

function parseRssItems(xml: string): FeedItem[] {
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return itemMatches
    .map((itemXml) => {
      const title = extractTag(itemXml, "title");
      const link = extractTag(itemXml, "link");
      const guid = extractTag(itemXml, "guid");
      const description = extractTag(itemXml, "description");
      const pubDate = extractTag(itemXml, "pubDate");
      const id = guid || link;

      if (!title || !link || !id) {
        return null;
      }

      return {
        id: cleanupText(id),
        title: cleanupText(title),
        link: cleanupText(link),
        description: summarizeDescription(description),
        pubDate: cleanupText(pubDate),
      } satisfies FeedItem;
    })
    .filter((item): item is FeedItem => item !== null);
}

function extractTag(xml: string, tagName: string): string {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function cleanupText(value: string): string {
  return decodeXmlEntities(stripCdata(value).trim());
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function summarizeDescription(value: string): string {
  const plainText = cleanupWhitespace(stripHtml(cleanupText(value)));

  if (!plainText) {
    return "New newsletter item";
  }

  if (plainText.length <= MAX_DESCRIPTION_LENGTH) {
    return plainText;
  }

  return `${plainText.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

async function postToDiscord(webhookUrl: string, item: FeedItem): Promise<void> {
  const timestamp = toIsoTimestamp(item.pubDate);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      embeds: [
        {
          title: item.title,
          url: item.link,
          description: item.description,
          footer: {
            text: FOOTER_TEXT,
          },
          timestamp,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook failed with status ${response.status}: ${body}`);
  }
}

function toIsoTimestamp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}
