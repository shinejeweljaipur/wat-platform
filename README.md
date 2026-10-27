# WA Platform

A self-hosted WhatsApp platform (AiSensy / WATI style) for your own brands, built on the **official WhatsApp Cloud API**.

**Included**
- **Team inbox**: live chats, assign to agents, tags, internal notes, close/reopen, 24-hour window handling (template picker when the window is closed)
- **Broadcast campaigns**: approved templates, audience by tag, opted-in contacts only, throttled queue, pause/resume, sent/delivered/read/failed stats
- **Contacts**: manual add, CSV import with opt-in confirmation, tags, STOP/START handling
- **Media**: send and receive images, video, audio and documents in the inbox (attach button); incoming files are fetched from Meta on demand. Limits: image 5 MB, video/audio/document 16 MB
- **Templates**: create and submit to Meta with optional header (text / image / video / document), footer and up to 3 buttons (quick reply, fixed https link, phone call); sync status (also updated automatically via webhook)
- **Automations**: keyword / welcome / fallback auto-reply flows (text, template, tag, wait, hand over to human) plus **questions with branching**: ask a question (optionally with up to 3 tap-to-reply buttons), wait for the answer, follow the matching branch (nested up to 4 levels), or an "if nothing matches" path
- **Shopify**: order confirmation, COD confirmation, shipped update, abandoned-cart reminder (cancelled automatically if the order is placed)
- **Multi-brand**: one WhatsApp number per "channel" (e.g. Shine Jewel, Mooneye, Star Joya), switch from the sidebar. Each has its own contacts, flows, templates and Shopify settings.
- **Team**: admin and agent roles

**Stack**: Next.js 14 (App Router, TypeScript) · Postgres · Tailwind. No ORM; the schema is created automatically on first start.

---

## 1. Deploy (all from web dashboards)

The app has a background worker (sends campaigns, abandoned-cart reminders), so it needs a host that runs a **long-lived server**: **Railway** or **Render** (not Vercel, unless you disable the worker and use an external cron; see "Serverless note" below).

1. **Database**: create a free Postgres on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy the connection string (it should end with `?sslmode=require`).
2. **Code**: upload this folder to a new private GitHub repository (github.com → New repository → "uploading an existing file" lets you drag and drop the folder; do not upload `node_modules`).
3. **Host**: on Railway/Render choose "Deploy from GitHub repo" and select it. Build command `npm install && npm run build`, start command `npm start`.
4. **Environment variables** (see `.env.example`):

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Any long random string (32+ chars) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin login. Created automatically on first start, only if no users exist |
| `WA_VERIFY_TOKEN` | Any secret string you choose; you'll paste the same one into Meta |
| `WA_APP_SECRET` | Meta App → Settings → Basic → App secret. **Required**: webhooks are rejected without it |
| `META_APP_ID` | Meta App → Settings → Basic → App ID. Needed **only** to create templates with an image/video/document header |
| `ENCRYPTION_KEY` | Optional. Key for encrypting access tokens and Shopify secrets in the database. If empty, `SESSION_SECRET` is used |

5. Open your app URL, sign in, and go to **Settings**.

## 2. Connect WhatsApp (Meta)

1. [developers.facebook.com](https://developers.facebook.com) → Create App (type *Business*) → add the **WhatsApp** product, link your Business account and add your phone number.
2. **Permanent token**: Business Settings → Users → **System Users** → add a system user → *Add assets* (your WhatsApp account) → *Generate token* with permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Do not use the temporary 24-hour token from the API Setup page.
3. Note your **Phone Number ID** and **WhatsApp Business Account ID** (WhatsApp → API Setup).
4. In this app: **Settings → Add a brand / number**, paste the Phone Number ID, WABA ID and token.
5. In Meta: **WhatsApp → Configuration → Webhook**
   - Callback URL: `https://YOUR-APP-URL/api/webhook/whatsapp`
   - Verify token: the `WA_VERIFY_TOKEN` value
   - Subscribe to **`messages`** and **`message_template_status_update`**
6. **Templates** page → *Sync from Meta*, or create new ones and wait for approval.

You can add all your numbers under the same Meta app. Messages are routed by Phone Number ID.

> **Test mode**: a brand added without Phone Number ID / token runs in test mode. Nothing is sent to WhatsApp, and Settings shows a "Simulate" box so you can try the whole inbox, bot and campaigns first.

## 3. Connect Shopify (per brand)

In **Automations → Shopify** the app shows the exact webhook URL for the selected brand and the steps:

1. Shopify admin → Settings → Notifications → Webhooks → create webhooks (JSON) for: Order creation, Order fulfillment, Checkout creation, Checkout update. URL: `https://YOUR-APP-URL/api/webhook/shopify/<channel id>`.
2. Paste the webhook **signing secret** into Settings → that brand → *Shopify signing secret*.
3. Pick which approved template to send for each event. Variable order is shown on the page.

## 4. Rules the app enforces for you

- **24-hour window**: free-text replies only within 24 h of the customer's last message; after that the inbox forces an approved template.
- **Opt-in**: campaigns and abandoned-cart reminders go only to contacts marked opted-in. CSV import asks you to confirm consent. Customers replying STOP are unsubscribed automatically.
- **Idempotent webhooks**: duplicate Meta and Shopify deliveries are ignored.
- **Safe sending**: the queue lives in Postgres; a crash or restart never double-sends (interrupted sends are marked failed, not retried blindly).
- Webhooks are signature-verified (Meta `X-Hub-Signature-256`, Shopify HMAC). Passwords are scrypt-hashed. Session cookies are signed and HttpOnly. Cross-origin writes are blocked.

## 5. Security of stored secrets

Access tokens and Shopify signing secrets are encrypted in the database (AES-256-GCM). Existing plain-text values are encrypted automatically on the next start. **If you change `ENCRYPTION_KEY` (or `SESSION_SECRET` when no `ENCRYPTION_KEY` is set), stored tokens can no longer be read and must be re-entered in Settings.** Set `ENCRYPTION_KEY` once and keep it separate from the database credentials.

## 6. Known limits (honest list)

- **Not yet tested against live Meta.** Everything was tested end to end against a real Postgres and a mock of the Graph API (135 automated checks), but not with real Meta credentials. Test with one number first.
- **Templates**: URL buttons with a variable, copy-code, flow and other special button types, variables inside headers, and location headers are not supported. Such templates are shown as "not sendable here".
- **Media**: files you send are stored in Postgres, so heavy media use grows the database. Customers' files can be fetched from Meta only for about 30 days.
- **Flows**: a customer's reply is matched by keyword or button title; free-form intent detection (AI) is not included. A reply that matches no branch repeats the question up to twice, then runs the "if nothing matches" path.
- **Real-time** is polling (every 3–4 s), not websockets. Fine for a small team.
- Costs: Meta bills per delivered template message (rates depend on category and country). Check Meta's current pricing page.

## Serverless note

If you must use a serverless host, set `ENABLE_WORKER=0`, set `CRON_SECRET`, and call `POST /api/cron/tick` every minute with header `Authorization: Bearer <CRON_SECRET>`. Bot "wait" steps and background sends after a webhook response can be cut short on serverless, so a long-running host is strongly recommended.

## Local development

```
cp .env.example .env     # fill in DATABASE_URL etc.
npm install
npm run dev
```
