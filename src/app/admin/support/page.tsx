import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { isReferralAdmin } from "@/lib/referrals";
import styles from "../referrals/referrals.module.css";
export const dynamic = "force-dynamic";
export default async function SupportInbox() {
  const userId = (await auth())?.user?.id; if (!userId) redirect("/sign-in"); if (!isReferralAdmin(userId)) notFound();
  const { rows } = await getDb().query<{ id: string; email: string; message: string; created_at: Date }>("SELECT id, email, message, created_at FROM support_tickets ORDER BY created_at DESC LIMIT 100");
  return <main className={styles.page}><header className={styles.header}><Link href="/">Mystery Match</Link><Link href="/admin/referrals">Referral dashboard</Link></header><div className={styles.content}><p className={styles.eyebrow}>PRIVATE · ADMIN ONLY</p><h1>Support tickets.</h1><p className={styles.intro}>Reply directly to the email address provided. Check this page for new tickets.</p>{rows.length ? rows.map((ticket) => <article className={styles.card} key={ticket.id}><p><strong>{ticket.email}</strong> · {new Date(ticket.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.message}</p></article>) : <p>No tickets yet.</p>}</div></main>;
}
