"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    // On success the browser is redirected; nothing else to do.
  }

  async function continueWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEmailSent(true);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Welcome back.
        </h1>

        {emailSent ? (
          <div className="mt-10 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
            <p className="text-sm font-medium">Check your inbox.</p>
            <p className="mt-1 text-sm">
              We sent a magic link to <strong>{email}</strong>. Click it and you&apos;ll be back here.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-2">
              <button
                onClick={continueWithGoogle}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
              >
                <span>🔑</span>
                <span>Continue with Google</span>
              </button>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <hr className="grow border-stone-200 dark:border-stone-800" />
              <span className="text-xs uppercase tracking-widest text-stone-400">
                or email
              </span>
              <hr className="grow border-stone-200 dark:border-stone-800" />
            </div>

            <form
              onSubmit={continueWithEmail}
              className="mt-4 flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@acme.com"
                className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                {busy ? "Sending…" : "Send magic link"}
              </button>
            </form>

            {error && (
              <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
          </>
        )}

        <p className="mt-8 text-sm text-stone-500">
          New here?{" "}
          <a href="/signup" className="underline">
            Become a design partner
          </a>
        </p>
      </div>
    </AppShell>
  );
}
