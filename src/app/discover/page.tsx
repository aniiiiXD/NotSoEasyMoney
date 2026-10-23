import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile, listCandidates } from "@/lib/local-matching";
import { hasAnswers } from "@/lib/personality";
import Discovery from "./discovery";
import { discoveryAccess } from "@/lib/discovery-access";
import { formatPaymentAmount } from "@/lib/billing-config";

export default async function DiscoverPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const profile = await getOwnProfile(db, userId);
  if (!profile) redirect("/join");
  if (!hasAnswers(profile.answers)) redirect("/join?edit=1");
  const billing = await discoveryAccess(userId);
  const candidates = await listCandidates(db, userId, billing.enabled ? { mode: billing.mode } : undefined) ?? [];
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  return <Discovery alias={profile.alias} initial={candidates} logout={logout} billing={{ enabled: billing.enabled, credit: billing.allowed, price: formatPaymentAmount(billing.amount) }} />;
}
