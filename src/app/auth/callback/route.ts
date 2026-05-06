import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { readConnection } from "@/lib/connection";

// OAuth + magic-link redirects land here. Exchange the code for a session,
// then route based on onboarding state: new users → /signup to finish
// onboarding, returning users → /dashboard (or `next=` override).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange failed:", error.message);
      const back = new URL("/login", req.url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  }

  // Decide where to send them. If they haven't completed onboarding
  // (no name/company on the connection), send to /signup so the wizard
  // resumes at the right step. Otherwise honor `next=` or default to dashboard.
  const conn = await readConnection();
  const target = !conn.signedUp ? "/signup" : (nextParam ?? "/dashboard");
  return NextResponse.redirect(new URL(target, req.url));
}
