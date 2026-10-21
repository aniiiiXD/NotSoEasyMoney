import pg from "pg";

const [action = "list", id] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!['list', 'reviewed'].includes(action) || (action === 'reviewed' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? ''))) {
  throw new Error('Use: npm run safety-reports -- list, or npm run safety-reports -- reviewed REPORT_ID');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, enableChannelBinding: true, max: 1 });
try {
  if (action === 'list') {
    const { rows } = await pool.query(`SELECT id, reason, reporter_id, reported_id, room_id, created_at
      FROM safety_reports WHERE status = 'open' ORDER BY created_at, id LIMIT 100`);
    if (!rows.length) console.log('No open reports.');
    else console.table(rows);
  } else {
    const result = await pool.query("UPDATE safety_reports SET status = 'reviewed', reviewed_at = now() WHERE id = $1 AND status = 'open'", [id]);
    console.log(result.rowCount ? 'Report marked reviewed.' : 'No open report found.');
  }
} catch (error) {
  let message = error instanceof Error ? error.message : 'Database error';
  message = message.replaceAll(process.env.DATABASE_URL, '[redacted]');
  const password = new URL(process.env.DATABASE_URL).password;
  if (password) message = message.replaceAll(password, '[redacted]');
  console.error(message);
  process.exitCode = 1;
} finally { await pool.end(); }
