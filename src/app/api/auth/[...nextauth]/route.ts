import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { withLocalOrigin } from "@/lib/auth-request";

export function GET(request: NextRequest) { return handlers.GET(withLocalOrigin(request)); }
export function POST(request: NextRequest) { return handlers.POST(withLocalOrigin(request)); }
