import type { Pool } from "pg";
import { lockProfiles, withTransaction } from "./db.ts";

export async function deleteAccount(db: Pool, userId: string): Promise<void> {
  await withTransaction(db, async (client) => {
    if (userId.startsWith("google:")) await client.query("SELECT user_id FROM app_users WHERE user_id = $1 FOR UPDATE", [userId]);
    await lockProfiles(client, [userId]);
    const profile = await client.query<{ analytics_consent: number }>("SELECT analytics_consent FROM profiles WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM analytics_events WHERE user_id = $1", [userId]);
    if (profile.rows[0]?.analytics_consent === 1 && !userId.startsWith("demo:")) {
      await client.query("DELETE FROM analytics_events WHERE event_name IN ('message_sent', 'match_created')");
    }
    await client.query("DELETE FROM support_tickets WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM profiles WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM app_users WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM local_test_accounts WHERE user_id = $1", [userId]);
  });
}
