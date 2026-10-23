import pg from "pg";

const [action = "list", inputCode = "", ...labelParts] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;
const code = inputCode.trim().toUpperCase();
const label = labelParts.join(" ").trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!["create", "list", "disable", "enable"].includes(action)) throw new Error("Use: referrals create CODE LABEL, list, disable CODE, or enable CODE.");
if (action !== "list" && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw new Error("Code must have 3–32 letters, numbers, hyphens or underscores and start with a letter or number.");
if (action === "create" && (!label || [...label].length > 80)) throw new Error("A label between 1 and 80 characters is required.");
const origin = new URL(process.env.APP_URL || "https://mystery-match-dating.vercel.app");
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("APP_URL must be an HTTPS origin, or a local HTTP origin.");
const pool = new pg.Pool({ connectionString, enableChannelBinding: true, max: 1 });
try {
  if (action === "create") {
    await pool.query("INSERT INTO referral_codes (code, label) VALUES ($1, $2)", [code, label]);
    console.log(`Created ${code} for ${label}.`);
    console.log(`Invitation: ${new URL(`/r/${code}`, origin)}`);
    console.log(`QR image: ${new URL(`/r/${code}/qr`, origin)}`);
  } else if (action === "disable" || action === "enable") {
    const result = await pool.query("UPDATE referral_codes SET active = $2 WHERE code = $1 RETURNING code", [code, action === "enable"]);
    if (!result.rowCount) throw new Error("Referral code was not found.");
    console.log(`${code} ${action === "enable" ? "enabled" : "disabled"}.`);
  } else {
    const { rows } = await pool.query(`SELECT c.code, c.label, c.active, c.clicks,
      COUNT(DISTINCT a.user_id)::integer AS signups,
      COUNT(DISTINCT a.user_id) FILTER (WHERE a.profile_completed_at IS NOT NULL)::integer AS profiles,
      COUNT(DISTINCT o.order_id)::integer AS payments
      FROM referral_codes c
      LEFT JOIN referral_attributions a ON a.code = c.code
      LEFT JOIN payment_orders o ON o.user_id = a.user_id AND o.status = 'paid'
      GROUP BY c.code, c.label, c.active, c.created_at, c.clicks ORDER BY c.created_at, c.code`);
    if (!rows.length) console.log("No referral codes yet.");
    else console.table(rows);
  }
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replaceAll(connectionString, "[redacted]");
  const password = new URL(connectionString).password;
  if (password) message = message.replaceAll(password, "[redacted]");
  console.error(message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
