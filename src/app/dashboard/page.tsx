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

export default function Dashboard() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  async function load() {
    const r = await fetch("/api/recall/bot");
    if (r.ok) {
      const j = await r.json();
      setMeetings(j.meetings ?? []);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
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
    await load();
  }

  return (
    <div className="min-h-dvh bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <a
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← back
          </a>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Send the bot to a call
        </h1>

        <form onSubmit={send} className="mt-8 grid gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Meeting URL
            </span>
            <input
              type="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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
            disabled={busy}
            className="justify-self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {busy ? "Dispatching…" : "Send PostHog"}
          </button>
          <p className="text-xs text-zinc-500">
            Once joined, say <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono dark:bg-zinc-800">Hey PostHog, …</code> in the call to ask a question.
          </p>
        </form>

        <h2 className="mt-12 text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Recent meetings
        </h2>
        <div className="mt-4 grid gap-4">
          {meetings.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              No meetings yet — paste a URL above to dispatch the bot.
            </div>
          )}
          {meetings.map((m) => (
            <a
              key={m.id}
              href={`/dashboard/${m.id}`}
              className="block rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
            >
              <div className="flex items-center justify-between">
                <div className="truncate font-mono text-sm text-zinc-700 dark:text-zinc-300">
                  {m.meetingUrl}
                </div>
                <span className="ml-3 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {m.status}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-zinc-500">
                bot: {m.recallBotId}
              </div>
              {m.questions.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  {m.questions.map((q) => (
                    <li key={q.id} className="text-sm">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="text-zinc-500">{q.askerName ?? "?"}: </span>
                        {q.question}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                        {q.answer}
                      </div>
                      {q.latencyMs != null && (
                        <div className="mt-0.5 text-xs text-zinc-500">
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
