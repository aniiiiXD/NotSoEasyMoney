import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { getDb, withTransaction } from "@/lib/db";
import { isSameOrigin, readJsonWithLimit, RequestBodyTooLarge } from "@/lib/request";

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to contact support." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "Expected JSON." }, { status: 415 });
  let input: unknown;
  try { input = await readJsonWithLimit(request, 4096); } catch (error) { return Response.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { email, message } = input as Record<string, unknown>;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 || typeof message !== "string" || message.trim().length < 10 || message.trim().length > 2000) return Response.json({ error: "Enter a valid email and a message of 10–2000 characters." }, { status: 400 });
  try {
    const result = await withTransaction(getDb(), async (client) => {
      if (userId.startsWith("google:")) {
        const account = await client.query("SELECT user_id FROM app_users WHERE user_id = $1 FOR UPDATE", [userId]);
        if (!account.rowCount) throw new Error("Account unavailable");
      }
      return client.query(`INSERT INTO support_tickets (id, user_id, email, message)
      SELECT $1, $2, $3, $4 WHERE (SELECT count(*) FROM support_tickets WHERE user_id = $2 AND created_at > now() - interval '1 hour') < 5 RETURNING id`, [randomUUID(), userId, email.trim(), message.trim()]);
    });
    return result.rowCount ? Response.json({ ok: true }, { status: 201 }) : Response.json({ error: "Please try again later." }, { status: 429 });
  } catch { return Response.json({ error: "Could not send your ticket. Please try again." }, { status: 500 }); }
}
