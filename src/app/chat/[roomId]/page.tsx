import { notFound, redirect } from "next/navigation";
import { auth, authConfigured, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { listRooms, readRoom } from "@/lib/chat";
import ChatClient from "../chat-client";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  if (!authConfigured) redirect("/sign-in");
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const profile = getDb().prepare("SELECT active FROM profiles WHERE user_id = ?").get(session.user.id) as { active: number } | undefined;
  if (!profile?.active) redirect("/join");
  const { roomId } = await params;
  const room = readRoom(session.user.id, roomId);
  if (!room) notFound();
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  const demoMode = process.env.NODE_ENV === "development" && session.user.id.startsWith("demo:");
  return <ChatClient key={roomId} initialRooms={listRooms(session.user.id)} selected={{ id: roomId, ...room }} logout={logout} demoMode={demoMode} />;
}
