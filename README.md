# Mystery Match

A Next.js prototype for getting to know someone before seeing their photo. Adults can create a nickname, answer connection-preference questions, receive blind introductions, and open a private chat after both people choose each other.

The [deployed application](https://mystery-match-ani.vercel.app) uses Neon Postgres for profiles, matching, chat, referrals, and opt-in analytics. Google sign-in has been tested through account registration on the deployed site, but Google currently permits only configured test users. This is not ready for a public launch. For frontend integration, see the [frontend handoff](docs/frontend-handoff.md).

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

## Influencer referrals

The unlisted `/admin/referrals` dashboard lets anyone with the URL create links, view signup and profile counts, open QR codes, and disable or re-enable invitations. Keep the URL private if you do not want other people to manage links. The support inbox remains protected by `REFERRAL_ADMIN_USER_IDS`; set it to a comma-separated list of the exact authenticated Google user IDs (`google:` followed by the provider subject). Set `APP_URL` to the public HTTPS origin, or a loopback HTTP origin for local testing; it determines the invitation and QR destinations.

Codes can also be managed from a trusted operator environment with `DATABASE_URL` set:

```bash
npm run referrals -- create CREATOR1 "Influencer name"
npm run referrals -- list
npm run referrals -- disable CREATOR1
npm run referrals -- enable CREATOR1
```

The create command prints an invitation link at `/r/CREATOR1` and a QR image at `/r/CREATOR1/qr`. Codes are 3–32 letters, numbers, hyphens, or underscores, beginning with a letter or number; they are normalized to uppercase. A visitor can remove an invitation before signing in. The first valid invitation is held for up to 30 days and is credited only when a Google account is first registered while the code remains active. Returning Google accounts do not create referral signups. The list command separately shows attributed Google signups and how many subsequently created a profile; it does not count link clicks.

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
