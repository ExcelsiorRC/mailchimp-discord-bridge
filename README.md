# Mailchimp to Discord Cloudflare Worker

This Worker polls a Mailchimp RSS feed every 15 minutes and posts new items to a Discord webhook.

Behavior:

- Uses Cloudflare Workers with TypeScript
- Stores the last seen feed item in KV namespace `NEWSLETTER_STATE`
- First run does not post historical items
- Posts only newly detected items after that
- Sends Discord embeds with title, link, short description, and footer `Excelsior Running Club`
- Sanitizes Mailchimp HTML so Discord descriptions do not show CSS or raw markup
- Removes duplicated leading titles from the description when the newsletter body starts with the same heading

## Files

- `src/index.ts`: Worker logic
- `test/sanitize-description.test.ts`: Regression test for description sanitization
- `.github/workflows/ci.yml`: GitHub Actions workflow that runs tests on `main` pushes and pull requests
- `wrangler.jsonc`: Worker config, cron trigger, KV binding

## Prerequisites

- Node.js 22 recommended
- Install project dependencies:

```bash
npm install
```

Before running Cloudflare commands, authenticate with Wrangler:

```bash
npx wrangler login
```

## 1. Create the KV namespace

Create the production namespace:

```bash
npx wrangler kv namespace create NEWSLETTER_STATE
```

Create the preview namespace:

```bash
npx wrangler kv namespace create NEWSLETTER_STATE --preview
```

Copy the returned IDs into [`wrangler.jsonc`](/Users/ayn/work/excelsior/mailchimp-discord-bridge/wrangler.jsonc).

Replace:

- `REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID`
- `REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID`

## 2. Set secrets

Set the Discord webhook URL:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

Set the Mailchimp RSS feed URL:

```bash
npx wrangler secret put MAILCHIMP_RSS_URL
```

Example feed URL shape:

```text
https://usX.campaign-archive.com/feed?u=...&id=...
```

## 3. Run locally

Start remote dev with scheduled testing enabled:

```bash
npm run dev
```

Test the scheduled handler locally:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=*/15+*+*+*+*"
```

Notes:

- `npm run dev` uses `wrangler dev --remote --test-scheduled`
- This lets local testing use the secrets you set with `wrangler secret put`
- The first scheduled run only stores the latest feed item in KV
- No Discord message is sent on that first run
- Later runs post only items newer than the stored item

## 4. Run tests

Run the sanitizer regression test locally:

```bash
npm test
```

Notes:

- The test uses Node's built-in test runner
- The current test command uses `--experimental-strip-types`, so Node 22 is the safest local and CI runtime
- The fixture uses a sanitized Mailchimp-like sample to guard against CSS and duplicate-title regressions

## 5. Deploy

Deploy the Worker:

```bash
npm run deploy
```

After deployment, Cloudflare will trigger the Worker every 15 minutes using:

```text
*/15 * * * *
```

## Manual values you still need to fill in

You need to provide:

- The two KV namespace IDs in [`wrangler.jsonc`](/Users/ayn/work/excelsior/mailchimp-discord-bridge/wrangler.jsonc)
- The `DISCORD_WEBHOOK_URL` secret
- The `MAILCHIMP_RSS_URL` secret

## Notes on behavior

- The Worker assumes the RSS feed is ordered newest-first, which is the normal Mailchimp RSS layout
- If the previously stored item is no longer present in the feed, the Worker advances the stored cursor to the current latest item and does not backfill older posts
- RSS parsing is done with small string-based parsing logic to avoid heavy dependencies
- The Discord description is limited to 240 characters and truncated with an ellipsis when needed
- The sanitizer strips HTML comments and `<style>`, `<script>`, and `<head>` blocks before flattening the content to plain text

## CI

GitHub Actions runs `npm test` on:

- pushes to `main`
- all pull requests
