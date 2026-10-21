# Local analytics contract

Analytics is opt-in and stored only in the local SQLite database. Events are not
sent to a vendor. This is intended for one local instance; an ephemeral or
multi-instance deployment needs a different persistent architecture.

The local demo uses fictional profiles and scripted replies. Demo and sample
identities never generate events for the real report; `/demo/analytics` shows
separately labeled, illustrative numbers rather than collected activity.

The user can change their preference at `/analytics/consent`. Turning it off
updates their profile and deletes their events in the same transaction. If an
account is deleted, delete its events as well; the events table intentionally
does not contain a profile foreign key. Never retroactively create events for
activity that happened before consent.

From trusted server code, after a successful product operation has committed:

```ts
import { recordEvent, recordMessageEvent, recordMatchEvent } from "@/lib/analytics";

recordEvent(session.user.id, "profile_saved");
recordMessageEvent(session.user.id, roomId); // after the message is stored
recordMatchEvent(session.user.id, roomId); // after a new room is created
```

Use the authenticated actor's server-side ID, not an ID from request JSON. The
allowlist is in `ANALYTICS_EVENTS`; the helper has no properties argument and
always stores empty metadata. It checks current consent in the insertion
statement, records at most one event of each kind per member per UTC day, and
returns false instead of interrupting the product action on failure. Do not
store names, messages, room IDs, profile answers, vectors, scores, demographics,
URLs, or any other user-supplied properties. `recordMessageEvent` and
`recordMatchEvent` verify that the actor belongs to the room and that both
participants have opted in. They store the actor and UTC day only; they store
no partner, room, or message data. Call `recordMatchEvent` once per participant.
Because the relationship is not kept in analytics, withdrawing consent clears
all messaging and match events for all members to ensure no indirect pair-level traces
remain. Account deletion must do the same whenever the deleted member had
analytics consent. Never record a pair-derived event with the single-person helper.

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
Suppression and restricted access reduce exposure; they are not a guarantee of
anonymity, particularly if the underlying local database is accessible.

Local events older than 90 days are removed on an analytics write or report
read. For expiry even while the app is idle, run `pruneAnalyticsEvents()` from a
scheduled local maintenance job; no background scheduler is configured here.
Database backups and operating-system logs need their own retention controls.
