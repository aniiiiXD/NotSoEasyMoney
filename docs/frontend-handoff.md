# Frontend handoff

Mystery Match is a Next.js App Router prototype. The deployed site at https://mystery-match-ani.vercel.app has a fictional account-free demo and a separate authenticated flow backed by Neon Postgres. Google sign-in is currently restricted to the test users configured in Google Cloud.

## Current flow

1. Sign in at `/sign-in`; a new Google account is registered and redirected to `/join`.
2. Complete the profile and questionnaire at `/join`.
3. Browse blind introductions at `/discover` and choose **Say hello** or **Pass**. Both people must choose each other for a room to open.
4. See rooms at `/chat`, open a conversation at `/chat/[roomId]`, send text messages, or block the other person.

The hosted `/preview` is fictional and resets on refresh. It does not demonstrate real accounts or live conversations. The authenticated chat persists in Neon and checks room membership on reads and writes. The current client polls about every five seconds; it does not use live push or WebSockets. Rooms currently return the latest 100 messages. Blocking closes a room for both people. Message text is limited to 2,000 characters; server rate limiting can return HTTP 429.

## API endpoints

These routes use the authenticated session cookie; callers do not supply user IDs. POST requests must originate from the application. Handle non-2xx responses and display their `error` message.

| Route | Purpose |
| --- | --- |
| `GET /api/profile` | Return `{ profile }` for the current member. |
| `POST /api/profile` | Save the onboarding payload. See `src/app/join/profile-form.tsx` for the current shape. |
| `GET /api/candidates` | Return `{ candidates }` containing opaque `candidateId`, `blindAlias`, and `explanation`. |
| `POST /api/candidates` | Send `{ candidateId, decision: "like" \| "pass" }`; a mutual like can return `{ status: "matched", roomId }`. |
| `GET /api/rooms` | Return `{ rooms }` with room ID, other person's alias, and last-message time. |
| `GET /api/rooms/[roomId]/messages` | Return `{ alias, messages }`; each message has `id`, `body`, `mine`, and `createdAt`. |
| `POST /api/rooms/[roomId]/messages` | Send `{ body }`; returns `{ message }` with HTTP 201. |
| `POST /api/rooms/[roomId]/block` | Block the other member and close the room; returns HTTP 204. |

See `src/app/chat/chat-client.tsx`, `src/app/discover/discovery.tsx`, and `src/app/join/profile-form.tsx` for existing client behavior. Do not expose database credentials, OAuth secrets, internal user IDs, or private questionnaire vectors to the browser.

Influencer codes are managed by an operator with `npm run referrals`; `/r/[code]` starts an invitation and `/r/[code]/qr` serves its QR image. Attribution is recorded for a newly registered Google account, not for every visit. Opt-in analytics and an admin-only aggregate dashboard exist; there is no influencer dashboard yet.

## Testing and remaining work

Google sign-in was tested on the deployed site through authenticated onboarding and a Neon registration. Matching and chat have automated integration and HTTP tests against disposable Neon test databases; a complete two-real-Google-account production conversation has not yet been verified. See the README for local setup and safe test-database instructions.

This is a prototype, not a public-launch-ready dating service. Before launch, work remains on Google publishing, safety and moderation, reporting and account deletion, privacy and operational review, and age/identity verification. Ages are currently self-reported; chat is not end-to-end encrypted. Avoid committing secrets or using production data in tests.
