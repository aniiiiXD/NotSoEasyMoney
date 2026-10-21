import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile, listCandidates } from "@/lib/local-matching";
import { hasAnswers } from "@/lib/personality";
import Discovery from "./discovery";

export default async function DiscoverPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const profile = await getOwnProfile(db, userId);
  if (!profile) redirect("/join");
  if (!hasAnswers(profile.answers)) redirect("/join?edit=1");
  const candidates = await listCandidates(db, userId) ?? [];
  const localTesting = process.env.NODE_ENV === "development" && process.env.LOCAL_TEST_LOGIN === "true";
  const demoMode = process.env.NODE_ENV === "development" && userId.startsWith("demo:");
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  return <Discovery alias={profile.alias} initial={candidates} localTesting={localTesting} demoMode={demoMode} logout={logout} />;
}
