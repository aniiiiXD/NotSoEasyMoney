import { notFound, redirect } from "next/navigation";
import { auth, authConfigured, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { listRooms, readRoom } from "@/lib/chat";
import ChatClient from "../chat-client";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  if (!authConfigured) redirect("/sign-in");
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const profile = (await getDb().query<{ active: number }>("SELECT active FROM profiles WHERE user_id = $1", [session.user.id])).rows[0];
  if (!profile?.active) redirect("/join");
  const { roomId } = await params;
  const room = await readRoom(session.user.id, roomId);
  if (!room) notFound();
  async function logout() { "use server"; await signOut({ redirectTo: "/" }); }
  return <ChatClient key={roomId} initialRooms={await listRooms(session.user.id)} selected={{ id: roomId, ...room }} logout={logout} />;
}
