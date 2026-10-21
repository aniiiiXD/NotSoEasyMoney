# Mystery Match

A local-first Next.js prototype for getting to know someone before seeing their photo. Adults can create a nickname, answer optional connection-preference questions, receive blind introductions, and open a private chat after both people choose each other.

The [Vercel landing page](https://mystery-match-ani.vercel.app) is deployed for preview. The matching, profiles, and chat still depend on a local SQLite file, and Google sign-in is disabled on Vercel until hosted storage is implemented. This is not ready for a public launch.

## Run locally

Requires Node.js 22.18+ or 24+ and npm. Node's built-in SQLite module may print an experimental warning.

For a fresh checkout without an `.env.local` file:

```bash
npm install
cp .env.example .env.local
openssl rand -base64 32
```

Paste the generated value into `AUTH_SECRET` in `.env.local`, then run:

```bash
npm run dev
```

Open the local address printed by Next.js. The development server binds to `127.0.0.1` and starts at port 3000; if that port is busy, Next.js selects another. To choose a port explicitly, use `npm run dev -- -p 3002`.

## Try the demo

On the local sign-in page, choose **Try the local demo** to start a fresh session without Google credentials. In the profile wizard, **Explore with a sample profile** takes you straight to fictional introductions. To walk through the questions, choose **Use sample answers and review the questions**, or enter your own answers. Say hello to a sample introduction to open a mutual match and go directly to its conversation; messages receive a scripted sample reply. The **Sample analytics** link shows illustrative numbers, not live activity. Signing out and starting a new demo creates a fresh session.

The demo is available only in development on a loopback address and requires the local `AUTH_SECRET`. Sample profiles are private to their demo session and are never shown to ordinary accounts. Demo activity is excluded from real analytics. Demo profiles and conversations are stored locally in the same database as other local data.

With `LOCAL_TEST_LOGIN=true`, expand **Use a local test account** on the sign-in page for development-only test accounts. Enter a new handle and a passphrase of at least eight characters to create one; use the same passphrase to return. To try a match, create a second account in a separate browser profile or private window, give each account mutually compatible age and gender preferences, answer at least three of the same questions, and choose “Say hello” from both accounts. A conversation appears for both people. Chats refresh about every five seconds. Blocking someone closes the room for both people.

Local profiles, messages, and settings are stored in `.local/closer.sqlite` on this computer. Keep that file private: chat messages and profiles are not end-to-end encrypted. `SQLITE_PATH` can optionally point to a different local database file. Local test accounts are disabled outside development.

## Google sign-in

Google sign-in is wired up but requires your own OAuth credentials. For local and Vercel configuration, including troubleshooting, see [Set up Google sign-in](docs/google-auth.md). To use it locally:

1. In [Google Cloud](https://console.cloud.google.com/), configure the OAuth consent screen and create an OAuth client of type **Web application**. Add your Google account as a test user if the app's audience is still in testing.
2. Add an authorized redirect URI matching the exact local address and port you use, followed by `/api/auth/callback/google`. For example, if the server prints `http://127.0.0.1:3002`, use `http://127.0.0.1:3002/api/auth/callback/google`.
3. Put the client ID and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env.local`, then restart the server.

Leave `AUTH_URL` and `NEXTAUTH_URL` unset for this local setup. Google requires an exact redirect URI match; localhost IP addresses are allowed for local HTTP development. See [Google's OAuth setup guide](https://developers.google.com/identity/openid-connect/openid-connect) and [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri_validation_rules). Google identity details are not shown in blind introductions; the application uses a provider subject to associate the login with the local account.

## Matching and analytics

The six-question questionnaire encodes stated preferences into a versioned numeric vector. Introductions require mutually compatible age and gender preferences, at least three shared answers, and no block or pass. Similarity ranks eligible introductions; it is not a clinical assessment or a prediction of relationship success.

Analytics is off by default. A member can opt in during onboarding and later change that choice at `/analytics/consent`. Aggregate reports at `/analytics` require the member's internal account ID in the comma-separated server environment variable `ANALYTICS_ADMIN_USER_IDS`. To find local account IDs on your own machine, use `sqlite3 .local/closer.sqlite 'SELECT user_id, alias FROM profiles;'`, add the relevant ID to `.env.local`, and restart. Reports cover the previous completed UTC week, use only opted-in activity, and suppress small groups. Pair-related events are recorded only when both people opt in. Turning consent off deletes the member's events and clears pair-derived event types for everyone. Events older than 90 days are pruned when analytics is written or read; there is no idle-time cleanup scheduler. See [the analytics contract](src/app/analytics/ANALYTICS.md) for details.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Before a public launch, the local SQLite design needs a hosted persistent database and a production security, privacy, moderation, account-deletion, and operations review. Ages are self-reported; no identity or age verification is implemented.
