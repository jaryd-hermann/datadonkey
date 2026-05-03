"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOOLS = [
  { id: "posthog", name: "PostHog", available: true, hasOAuth: true, oauthLabel: "Continue with PostHog" },
  { id: "mixpanel", name: "Mixpanel", available: false, hasOAuth: false },
  { id: "amplitude", name: "Amplitude", available: false, hasOAuth: false },
] as const;

export default function Signup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("posthog");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTool = TOOLS.find((t) => t.id === tool)!;

  async function submitAndContinue(method: string) {
    setError(null);
    if (!name.trim() || !company.trim()) {
      setError("Name and company are required");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: name,
        userCompany: company,
        userEmail: email || undefined,
        provider: tool,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    console.log(`(mock) signed up via ${method}`);
    router.push("/onboarding/connect");
  }

  return (
    <div className="min-h-dvh bg-stone-50 dark:bg-stone-950">
      <div className="mx-auto max-w-md px-6 py-16">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
          <span>🫏</span>
          <span>datadonkey</span>
        </a>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Let&apos;s get you set up.
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Takes a minute. We&apos;ll connect your data tool on the next page.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitAndContinue("email");
          }}
          className="mt-10 space-y-5"
        >
          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Rivera"
              className="input"
            />
          </Field>

          <Field label="Company">
            <input
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme"
              className="input"
            />
          </Field>

          <Field label="Data tool">
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as (typeof TOOLS)[number]["id"])}
              className="input"
            >
              {TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {!t.available && " — coming soon"}
                </option>
              ))}
            </select>
          </Field>

          <div className="border-t border-stone-200 pt-6 dark:border-stone-800">
            <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
              Continue with
            </p>

            <div className="mt-3 grid gap-2">
              {selectedTool.hasOAuth && selectedTool.oauthLabel && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitAndContinue(selectedTool.id)}
                  className="flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
                >
                  <span>🦔</span>
                  <span>{selectedTool.oauthLabel}</span>
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => submitAndContinue("google")}
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

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@acme.com"
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </form>

        <p className="mt-8 text-xs text-stone-500">
          Mock auth for the prototype. We&apos;ll wire up real SSO before launch.
        </p>
      </div>

      <style jsx global>{`
        .input {
          display: block;
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid rgb(212 212 209);
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(28 25 23);
        }
        @media (prefers-color-scheme: dark) {
          .input {
            border-color: rgb(63 63 60);
            background: rgb(28 25 23);
            color: rgb(245 245 244);
          }
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
