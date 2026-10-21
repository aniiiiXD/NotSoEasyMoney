import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SupportForm from "./support-form";
import styles from "../admin/referrals/referrals.module.css";
export default async function SupportPage() {
  if (!(await auth())?.user?.id) redirect("/sign-in");
  return <main className={styles.page}><header className={styles.header}><Link href="/">Mystery Match</Link><Link href="/account">Back to account</Link></header><div className={styles.content}><h1>How can we help?</h1><p className={styles.intro}>Send us a ticket and include an email address where we can reply.</p><SupportForm /></div></main>;
}
