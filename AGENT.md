# Agent Notes

This repository is a small Cloudflare Worker that polls a Mailchimp RSS feed and posts to a Discord webhook.

## Local expectations

- Use Node 22 when running tests locally
- Use `npm test` for the regression test suite
- Use `npm run dev` for remote Wrangler development with scheduled testing

## Behavior to preserve

- First scheduled run initializes KV and does not post historical items
- Discord descriptions must be plain text only
- Mailchimp CSS, comments, and raw HTML must never appear in Discord messages
- If the newsletter body starts with the same title or section heading as the feed title, drop that duplicate text from the description
- Keep the description capped at 240 characters

## Editing guidance

- Prefer small, dependency-free parsing changes unless there is a clear need for a library
- If you touch description formatting, update or add a regression test in `test/sanitize-description.test.ts`
- If CI behavior changes, keep `.github/workflows/ci.yml` aligned with the documented local test command
