import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { deleteAccount } from "@/lib/account";
import { isSameOrigin } from "@/lib/request";

export async function DELETE(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  try { await deleteAccount(getDb(), userId); return new Response(null, { status: 204 }); }
  catch { return Response.json({ error: "Could not delete your account. Please try again." }, { status: 500 }); }
}
