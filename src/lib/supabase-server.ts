import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client. Reads + writes session cookies.
// Use from route handlers / server components / server actions.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Setting cookies can throw in server components — only Route
            // Handlers / Server Actions / middleware can write them. The
            // middleware below ensures session cookies are kept fresh.
          }
        },
      },
    },
  );
}

// Returns the current auth user (or null if signed out). Cheap call —
// uses the local session, no extra network hop unless the access token
// is expired.
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}
