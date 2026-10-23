# Mystery Match

A Next.js prototype for getting to know someone before seeing their photo. Adults can create a nickname, answer connection-preference questions, receive blind introductions, and open a private chat after both people choose each other.

The [deployed application](https://mystery-match-dating.vercel.app) uses Neon Postgres for profiles, matching, chat, referrals, and opt-in analytics. Google sign-in has been tested through account registration on the deployed site, but Google currently permits only configured test users. This is not ready for a public launch. For frontend integration, see the [frontend handoff](docs/frontend-handoff.md).

## Run locally

Requires Node.js 22.18+ or 24+ and npm, plus a Neon Postgres database. For a fresh checkout:

```bash
npm install
cp .env.example .env.local
openssl rand -base64 32
```

Put the generated value in `AUTH_SECRET` in `.env.local`. Set `DATABASE_URL` to the **pooled** Neon connection string for the app and `DATABASE_URL_UNPOOLED` to the **direct/unpooled** connection string for the same database. Keep both URLs and `AUTH_SECRET` private; `.env.local` is ignored by Git. Existing shell environment variables take precedence over the file, so make sure they point to the intended database. Apply the schema before starting the app:

```bash
npm run db:migrate
npm run dev
```

The migration command reads `DATABASE_URL_UNPOOLED`, applies pending files in `migrations/`, and checks previously applied migration checksums. The development server binds to `127.0.0.1` and starts at port 3000; if that port is busy, Next.js selects another. To choose a port explicitly, use `npm run dev -- -p 3002`.

Profiles, messages, and settings are stored in the configured hosted database. Restrict database access and protect its credentials; chat messages and profiles are not end-to-end encrypted.

## Google sign-in

Google sign-in is configured on the production deployment and has been tested through the profile setup screen and account registration. The Google app is in Testing mode, so sign-in is limited to its listed test users. It requires a migrated database, an `AUTH_SECRET`, and Google OAuth credentials. For setup and troubleshooting, see [Set up Google sign-in](docs/google-auth.md).

For local development, create a Google OAuth **Web application** client, add your Google account as a test user if the app is in testing, and register the exact callback URL for your local host and port, such as `http://127.0.0.1:3002/api/auth/callback/google`. Add the client ID and secret as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env.local` and restart. Leave `AUTH_URL` and `NEXTAUTH_URL` unset for this local setup. Google identity details are not shown in blind introductions; the application uses the provider subject to associate the login with the account.

## Paid introductions and Razorpay UPI checkout

The payment gate is **off by default**. When enabled, the questionnaire discloses the price per introduction from its first screen and again before the final button. The final button saves the profile and opens `/checkout`; cancelling or losing the network preserves the saved profile. Checkout uses Razorpay Standard Web Checkout, including UPI when enabled on the merchant account. No subscription is created and no match is guaranteed.

The server filters `/discover` and candidate API reads to purchased introductions while billing is enabled. Only `POST /api/introductions/reveal` spends a payment, atomically, for one eligible person. GET requests, prefetches and refreshes never spend payments. Concurrent reveal retries return the same undecided person. An empty pool leaves the payment unused. Orders belong to the signed-in Google account, use the server's price, and persist in Postgres. Only a captured payment supplies one introduction credit. A consumed payment cannot reveal a second person; another payment is required. Paid members do not pay again for profile edits. Existing chat remains accessible. Test purchases never unlock live-mode access. Full or partial refunds revoke that purchase's access; account deletion cascades payment records, and late webhooks cannot restore a deleted account.

Configuration (server environment variables):

```dotenv
DISCOVERY_PAYWALL_ENABLED=false
DISCOVERY_PRICE_PAISE=2000
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

`2000` is ₹20 per new introduction; `100` is ₹1. The price is configurable and is never trusted from the browser. The public key ID is returned with each order, so changing keys does not depend on a stale browser build. `NEXT_PUBLIC_RAZORPAY_KEY_ID` is optional for compatibility and the secret must never use a public prefix. Keep all credentials in ignored environment files or Vercel's secret settings.

Apply `npm run db:migrate` using `DATABASE_URL_UNPOOLED` before enabling the flag. In Razorpay, enable automatic capture. The app automatically creates or updates its webhook in the mode selected by the keys before creating the first new order, so switching to live credentials does not require another manual webhook step. This fails closed if merchant webhook permissions are unavailable. It uses the configured `RAZORPAY_WEBHOOK_SECRET`:

```text
https://mystery-match-dating.vercel.app/api/payments/razorpay/webhook
payment.authorized, payment.captured, payment.failed, order.paid, refund.processed
```

`npm run payments:setup` registers or resyncs this app's webhook for the mode selected by the supplied API keys. It first probes the deployed endpoint to confirm the signing secret matches; it never prints credentials. This is also the recovery command if the merchant account changes or a webhook is deleted/disabled. Test mode does not collect real money. Live mode requires approval of the correct business, website and payment methods.

Launch after the migration: set Vercel Production `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to the approved live pair, set `DISCOVERY_PAYWALL_ENABLED=true`, and redeploy. Keep the configured webhook secret. Turning the flag back to `false` reopens introductions without changing purchases; authenticated verification and signed webhook processing continue while the flag is off.

Endpoints: `POST /api/create-order` (signed in, flag on, complete profile), `POST /api/verify-payment` (account-owned order and HMAC-SHA256 proof), `POST /api/payments/status` (reconcile a pending order when browser confirmation was lost), and `POST /api/payments/razorpay/webhook` (raw-body signature, no browser session). The API returns 402 for an unpaid reveal or decision on a locked person, 400 for invalid proofs or price manipulation, and 401 for missing authentication. Provider responses are re-fetched before applying state. Row locks and monotonic refund/capture handling make duplicate and out-of-order notifications safe.

The payment tests require a migrated, isolated `mm_test_` Postgres database. Run `node --test tests/billing-config.test.ts tests/razorpay.test.ts` for isolated unit tests, and use the test database environment for `tests/payments.test.ts`. `scripts/e2e-billing.mjs --setup` prepares local browser onboarding with simulated identities and real Razorpay test orders; `--verify` checks capture, access control and simulated signed-webhook replay against the real provider API. It refuses non-test databases, non-local app origins and live keys.

## Influencer referrals

The unlisted `/admin/referrals` dashboard lets anyone with the URL create links, view click, signup, payment, and completed-profile counts, open QR codes, and disable or re-enable invitations. Keep the URL private if you do not want other people to manage links. The support inbox remains protected by `REFERRAL_ADMIN_USER_IDS`; set it to a comma-separated list of the exact authenticated Google user IDs (`google:` followed by the provider subject). Set `APP_URL` to the public HTTPS origin, or a loopback HTTP origin for local testing; it determines the invitation and QR destinations.

Codes can also be managed from a trusted operator environment with `DATABASE_URL` set:

```bash
npm run referrals -- create CREATOR1 "Influencer name"
npm run referrals -- list
npm run referrals -- disable CREATOR1
npm run referrals -- enable CREATOR1
```

The create command prints an invitation link at `/r/CREATOR1` and a QR image at `/r/CREATOR1/qr`. Codes are 3–32 letters, numbers, hyphens, or underscores, beginning with a letter or number; they are normalized to uppercase. A visitor can remove an invitation before signing in. The first valid invitation is held for up to 30 days and is credited only when a Google account is first registered while the code remains active. Returning Google accounts do not create referral signups. The list command shows invitation-link clicks, attributed Google signups, how many subsequently created a profile, and captured payments by those members. Clicks count raw visits to the invitation link, including QR scans and repeat visits; disabled codes stop counting. Payments come from live order records, so refunds remove themselves and multiple payments by one member never inflate signup counts.

Referral attribution is stored separately from opt-in usage analytics and associates the account ID with a code. The unlisted operator dashboard and CLI show exact counts without the analytics dashboard's small-group suppression; there is no influencer-facing reporting portal. Share the dashboard URL carefully because it has write access.

## Safety reports

Members can report and block the other person from an open conversation. Reporting closes the room for both people and records the selected reason for an operator to review. On a trusted operator machine with database access, run `npm run safety-reports -- list` to list up to 100 open reports and `npm run safety-reports -- reviewed REPORT_ID` after review. The queue contains sensitive member and room identifiers; restrict its access and handle it privately. There are no automatic alerts or staffed moderation built into this prototype: the operator must monitor the queue and define a response process.

## Support and account deletion

Signed-in members can open **Account & support** to send a support ticket or delete their account. Tickets ask for a reply email and are visible at `/admin/support` to operators listed in `REFERRAL_ADMIN_USER_IDS`; operators must check the page and reply manually, as there are no notifications or in-app replies. Deleting an account removes its profile, referral attribution, support tickets, matches, conversations and related messages and reports, and clears analytics as described below. This also removes the affected conversations for the other members. Database backups may retain past data according to the database provider's retention policy. The deletion invalidates existing Google sessions; signing in again starts a new account.

## Matching and analytics

The 20-question questionnaire encodes stated preferences into a versioned numeric vector. Members answer at least three questions and may skip the rest. Introductions require mutually compatible age and gender preferences, at least three shared answers, and no block or pass. Similarity ranks eligible introductions; it is not a clinical assessment or a prediction of relationship success. Members with the previous questionnaire must answer the new version before receiving introductions.

Analytics is off by default. A member can opt in during onboarding and later change that choice at `/analytics/consent`. Aggregate reports at `/analytics` require the member's internal account ID in the comma-separated server environment variable `ANALYTICS_ADMIN_USER_IDS`. An operator can find the appropriate ID in the database's restricted SQL console, for example with `SELECT user_id, alias FROM profiles;`; add the ID to the server environment and restart or redeploy. Reports cover the previous completed UTC week, use only opted-in activity, and suppress small groups. Pair-related events are recorded only when both people opt in. When a real member withdraws previously granted consent, their events are deleted and pair-derived event types are cleared for everyone. Events older than 90 days are pruned on standalone analytics writes or report reads; there is no idle-time cleanup scheduler. See [the analytics contract](src/app/analytics/ANALYTICS.md) for details.

## Checks

The integration tests delete data. Create a separate disposable Postgres database whose name begins `mm_test_`, with the rest of the name made up of letters, numbers, or underscores. Put its pooled `DATABASE_URL` and matching direct `DATABASE_URL_UNPOOLED` in an ignored `.env.test.local` file. Apply the migrations to that test database, then run the suite serially:

```bash
env -u DATABASE_URL -u DATABASE_URL_UNPOOLED node --env-file=.env.test.local scripts/migrate.mjs
env -u DATABASE_URL -u DATABASE_URL_UNPOOLED node --env-file=.env.test.local --test --test-concurrency=1 tests/*.test.ts
npm run typecheck
npm run lint
npm run build
```

Do not run database tests against production or any database containing data you need. The test database must already have the migrations applied; the scripts do not create a Neon database for you. `npm test` uses the `DATABASE_URL` in its process environment and does not load `.env.local` itself.

To exercise the built app over HTTP, start it with the test database and a disposable secret in one terminal:

```bash
env -u DATABASE_URL -u DATABASE_URL_UNPOOLED AUTH_SECRET=disposable-local-test-secret AUTH_TRUST_HOST=true REFERRAL_ADMIN_USER_IDS=google:e2e-admin APP_URL=http://127.0.0.1:3015 node --env-file=.env.test.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3015
```

Then run the end-to-end check in another terminal:

```bash
env -u DATABASE_URL -u DATABASE_URL_UNPOOLED AUTH_SECRET=disposable-local-test-secret APP_URL=http://127.0.0.1:3015 node --env-file=.env.test.local scripts/e2e-neon.mjs
```

The check exercises private referral administration and access controls, decodes a QR image, and tests referral attribution, profile creation, matching, chat, and analytics consent using simulated identities. It does not sign in to a real Google account.

Before a public launch, the app still needs a production security, privacy, moderation, account-deletion, and operations review. Ages are self-reported; no identity or age verification is implemented.
