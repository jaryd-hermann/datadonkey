import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes Supabase session cookies on every request so the user stays
// logged in across navigations.
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Calling getUser refreshes the access token if needed, which writes
  // updated cookies via setAll above.
  await supabase.auth.getUser();

  // Gate /signup behind /partner — design partners only during private beta.
  // Logic: if hitting /signup without partner_verified=1 cookie, redirect.
  const pathname = request.nextUrl.pathname;
  if (pathname === "/signup") {
    const verified = request.cookies.get("partner_verified")?.value === "1";
    if (!verified) {
      const url = request.nextUrl.clone();
      url.pathname = "/partner";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on every page request except the static asset paths
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
