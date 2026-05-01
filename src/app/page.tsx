"use client";

import { useEffect, useState } from "react";

interface PostHogStatus {
  connected: boolean;
  projectId?: string;
  host?: string;
}

export default function Home() {
  const [status, setStatus] = useState<PostHogStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [host, setHost] = useState("https://us.posthog.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/posthog");
    setStatus(await r.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/posthog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, projectId, host }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? "Failed");
      return;
    }
    setApiKey("");
    await load();
  }

  return (
    <div className="min-h-dvh bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          PostHog Calls
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          A bot that joins your calls and answers PostHog questions when someone says
          {' '}<code className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-sm dark:bg-zinc-800">Hey PostHog</code>.
        </p>

        <section className="mt-10 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              1. Connect PostHog
            </h2>
            {status?.connected ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                Connected · project {status.projectId}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Not connected
              </span>
            )}
          </div>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Personal API Key
              </span>
              <input
                type="password"
                placeholder="phx_…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                required
              />
              <span className="text-xs text-zinc-500">
                Generate at{" "}
                <a
                  href="https://us.posthog.com/settings/user-api-keys"
                  target="_blank"
                  className="underline"
                >
                  posthog.com → settings → personal API keys
                </a>
                . Needs read scopes for query, insight, dashboard, feature_flag, experiment, action, cohort, error_tracking, session_recording.
              </span>
            </label>

            <div className="grid grid-cols-3 gap-4">
              <label className="col-span-1 grid gap-1.5">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Project ID
                </span>
                <input
                  type="text"
                  placeholder="361026"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  required
                />
              </label>
              <label className="col-span-2 grid gap-1.5">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Host
                </span>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="justify-self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {busy ? "Validating…" : status?.connected ? "Update connection" : "Connect"}
            </button>
          </form>
        </section>

        {status?.connected && (
          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              2. Send the bot to a call
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Head to the dashboard to paste a Google Meet, Zoom, or Teams URL.
            </p>
            <a
              href="/dashboard"
              className="mt-4 inline-block rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Open dashboard →
            </a>
          </section>
        )}
      </div>
    </div>
  );
}
