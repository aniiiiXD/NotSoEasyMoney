import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile } from "@/lib/local-matching";
import { hasAnswers } from "@/lib/personality";
import ProfileForm from "./profile-form";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  const profile = await getOwnProfile(getDb(), userId);
  const { edit } = await searchParams;
  if (profile && hasAnswers(profile.answers) && edit !== "1") redirect("/discover");
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  const demoMode = process.env.NODE_ENV === "development" && userId.startsWith("demo:");
  return <ProfileForm initial={profile} logout={logout} demoMode={demoMode} />;
}
