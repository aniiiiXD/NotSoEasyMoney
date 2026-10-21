import { redirect } from "next/navigation";
import { auth, authConfigured, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { listRooms } from "@/lib/chat";
import ChatClient from "./chat-client";

export default async function ChatPage() {
  if (!authConfigured) redirect("/sign-in");
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const profile = (await getDb().query<{ active: number }>("SELECT active FROM profiles WHERE user_id = $1", [session.user.id])).rows[0];
  if (!profile?.active) redirect("/join");
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  const demoMode = process.env.NODE_ENV === "development" && session.user.id.startsWith("demo:");
  return <ChatClient key="inbox" initialRooms={await listRooms(session.user.id)} selected={null} logout={logout} demoMode={demoMode} />;
}
