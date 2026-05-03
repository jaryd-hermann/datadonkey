"use client";

import { useEffect, useState } from "react";

interface Question {
  id: string;
  question: string;
  answer: string;
  askerName: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface Meeting {
  id: string;
  recallBotId: string;
  meetingUrl: string;
  status: string;
  createdAt: string;
  questions: Question[];
}

interface ConnectionInfo {
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  userCompany: string | null;
  provider: { id: string; name: string; available: boolean };
}

export default function Dashboard() {
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  async function loadAll() {
    const [cRes, mRes] = await Promise.all([
      fetch("/api/connection"),
      fetch("/api/recall/bot"),
    ]);
    if (cRes.ok) setConn(await cRes.json());
    if (mRes.ok) {
      const j = await mRes.json();
      setMeetings(j.meetings ?? []);
    }
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 4_000);
    return () => clearInterval(t);
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/recall/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: url }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? "Failed");
      return;
    }
    setUrl("");
    await loadAll();
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-6 py-12 dark:bg-stone-950">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
            <span>🫏</span>
            <span>datadonkey</span>
          </a>
          {conn?.userName && (
            <div className="text-xs text-stone-500">
              {conn.userName}
              {conn.userCompany ? ` · ${conn.userCompany}` : ""}
            </div>
          )}
        </header>

        {/* Connection banner */}
        {conn && (
          <div
            className={`mt-6 rounded-md border px-4 py-3 text-sm ${
              conn.connected
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            {conn.connected ? (
              <span>
                Connected to <strong>{conn.provider.name}</strong>
                {!conn.provider.available && (
                  <em>
                    {" "}— credentials saved; live Q&amp;A turns on once {conn.provider.name}&apos;s MCP ships
                  </em>
                )}
                .{" "}
                <a href="/onboarding/connect" className="underline">
                  Reconnect
                </a>
              </span>
            ) : (
              <span>
                <a href="/onboarding/connect" className="underline">
                  Connect {conn.provider.name}
                </a>{" "}
                to start sending the bot to calls.
              </span>
            )}
          </div>
        )}

        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Send the bot to a call
        </h1>

        <form
          onSubmit={send}
          className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900"
        >
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
              Meeting URL
            </span>
            <input
              type="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              required
            />
          </label>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !conn?.connected}
            className="justify-self-start rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {busy ? "Dispatching…" : `Send ${conn?.provider.name ?? "bot"}`}
          </button>
          {conn && (
            <p className="text-xs text-stone-500">
              Once joined, say{" "}
              <code className="rounded bg-stone-200 px-1 py-0.5 font-mono dark:bg-stone-800">
                Hey {conn.provider.name}, …
              </code>{" "}
              in the call to ask a question.
            </p>
          )}
        </form>

        <h2 className="mt-12 text-lg font-medium text-stone-900 dark:text-stone-100">
          Recent meetings
        </h2>
        <div className="mt-4 grid gap-4">
          {meetings.length === 0 && (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900">
              No meetings yet — paste a URL above to dispatch the bot.
            </div>
          )}
          {meetings.map((m) => (
            <a
              key={m.id}
              href={`/dashboard/${m.id}`}
              className="block rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800/60"
            >
              <div className="flex items-center justify-between">
                <div className="truncate font-mono text-sm text-stone-700 dark:text-stone-300">
                  {m.meetingUrl}
                </div>
                <span className="ml-3 shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {m.status}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-stone-500">
                bot: {m.recallBotId}
              </div>
              {m.questions.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-stone-100 pt-4 dark:border-stone-800">
                  {m.questions.map((q) => (
                    <li key={q.id} className="text-sm">
                      <div className="font-medium text-stone-900 dark:text-stone-100">
                        <span className="text-stone-500">{q.askerName ?? "?"}: </span>
                        {q.question}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-stone-700 dark:text-stone-300">
                        {q.answer}
                      </div>
                      {q.latencyMs != null && (
                        <div className="mt-0.5 text-xs text-stone-500">
                          {(q.latencyMs / 1000).toFixed(1)}s
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
