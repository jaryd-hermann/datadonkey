import { NextResponse } from "next/server";
import { getCurrentUser } from "./supabase-server";

// Resolve the current Supabase user's ID, or return a 401 NextResponse if
// there's no session. Keeps every API route's auth boilerplate to one line.
//
// Usage:
//   const auth = await requireUserId();
//   if (auth instanceof NextResponse) return auth;
//   const userId = auth;
export async function requireUserId(): Promise<string | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return user.id;
}

// Optional variant — returns null instead of a response. For routes that
// want to gracefully handle anonymous callers (e.g. landing-page-side fetches).
export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}
