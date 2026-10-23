import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile } from "@/lib/local-matching";
import { hasAnswers } from "@/lib/personality";
import ProfileForm from "./profile-form";
import { discoveryAccess } from "@/lib/discovery-access";
import { formatPaymentAmount } from "@/lib/billing-config";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  const profile = await getOwnProfile(getDb(), userId);
  const { edit } = await searchParams;
  if (profile && hasAnswers(profile.answers) && edit !== "1") redirect("/discover");
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  const access = await discoveryAccess(userId);
  return <ProfileForm initial={profile} logout={logout} paymentRequired={!access.allowed} price={formatPaymentAmount(access.amount)} testMode={access.mode === "test"} />;
}
