import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AccountControls from "./controls";
import styles from "../admin/referrals/referrals.module.css";

export default async function AccountPage() {
  if (!(await auth())?.user?.id) redirect("/sign-in");
  return <main className={styles.page}><header className={styles.header}><Link href="/">Mystery Match</Link><Link href="/discover">Back to app</Link></header><div className={styles.content}><h1>Your account.</h1><p className={styles.intro}>Manage your account or get in touch.</p><p><Link href="/support">Contact support →</Link></p><p><Link href="/checkout">Open payment checkout →</Link></p><AccountControls /></div></main>;
}
