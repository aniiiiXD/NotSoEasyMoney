# Analytics contract

Usage analytics is opt-in and stored in the configured Neon Postgres database;
events are not sent to a third-party analytics service. The database is hosted,
including when the app runs locally. Protect its credentials, access, and backups.

The local demo uses fictional profiles and scripted replies. Demo and sample
identities never generate events for the real report; `/demo/analytics` shows
separately labeled, illustrative numbers rather than collected activity.

The user can change their preference at `/analytics/consent`. Turning it off
updates their profile and deletes their events in the same transaction. If an
account is deleted, delete its events as well; the events table intentionally
does not contain a profile foreign key. Never retroactively create events for
activity that happened before consent.

For product actions, record analytics inside the same database transaction,
after the product write and while the relevant profile rows are locked. This
keeps the consent check tied to the action instead of a later consent state:

```ts
import { recordEventInTransaction, recordRoomEventInTransaction } from "@/lib/analytics";

// Within the transaction that saves a profile, with its profile row locked:
await recordEventInTransaction(client, actorId, "profile_saved");

// Within the transaction that stores a message, with both profiles locked:
await recordRoomEventInTransaction(client, actorId, roomId, "message_sent");

// Within the transaction that creates a room, with both profiles locked:
await recordRoomEventInTransaction(client, userA, roomId, "match_created");
await recordRoomEventInTransaction(client, userB, roomId, "match_created");
```

Use the authenticated actor's server-side ID, not an ID from request JSON.
Lock multiple profiles in canonical order using `lockProfiles` from
`@/lib/db` before taking room locks. Await helper calls sequentially on the
transaction client. The helpers use a savepoint so an optional event insertion
failure can be rolled back without aborting the product action. If the
savepoint itself cannot be established or restored, propagate the error so the
transaction can roll back safely. For a standalone event such as sign-in,
`await recordEvent(userId, "signed_in")` returns false if it cannot record.

The single-person event allowlist is in `ANALYTICS_EVENTS`; helpers have no
properties argument and always store empty metadata. They record at most one
event of each kind per member per UTC day. Do not store names, messages, room
IDs, profile answers, vectors, scores, demographics, URLs, or any other
user-supplied properties. The room helper checks that the room is active, the
actor belongs to it, and both participants consent. It stores the actor and UTC
day only; it stores no partner, room, or message data. Never record a
pair-derived event with the single-person helper. Because the relationship is
not kept in analytics, a real member withdrawing previously granted consent
clears all messaging and match events for all members to remove indirect
pair-level traces. Account deletion must do the same whenever the deleted
member had analytics consent.

`/analytics` and `GET /api/analytics` require a valid session and an exact ID in
the server-only, comma-separated `ANALYTICS_ADMIN_USER_IDS` environment
variable. An empty or missing variable grants access to nobody. Set it to the
actual session user IDs, not emails. Never use `NEXT_PUBLIC_` for this value.

The report shows the last fully completed Monday-to-Monday UTC week. Active
members are distinct people with any allowlisted event; the other values are
distinct active members with that event. These reflect opted-in activity only.
Events that are not yet instrumented do not imply zero overall product usage.
Counts below 20 are hidden, as are subgroup counts where the remaining active
cohort is below 20. Visible counts are rounded down to a multiple of five. Weekly
retention is the share of members active in the preceding completed week who
were also active in the reported week. It requires at least 20 retained and 20
not-retained members, and is rounded to the nearest five percentage points.
Suppression and restricted access reduce exposure; they do not guarantee
anonymity, particularly for someone with access to the underlying database.

Events older than 90 days are removed on standalone analytics writes or report
reads. For expiry even while the app is idle or only transaction-scoped events
are being written, run `pruneAnalyticsEvents()` from a scheduled maintenance
job; no background scheduler is configured here. Database backups and logs need
their own retention controls.

Referral attribution is a separate feature: first-time Google registrations
may be linked to an invitation code and profile completion is counted
separately. The private operator CLI reports exact referral counts and does not
use the opt-in analytics event table or its suppression rules. See the
[referral instructions](../../../README.md#influencer-referrals).
