"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function Landing() {
  return (
    <AppShell>
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-16 sm:pt-24">
        <Hero />
        <HowItWorks />
        <WhoItsFor />
      </main>
    </AppShell>
  );
}

function Hero() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setIsAuthed(!!data.user))
      .catch(() => setIsAuthed(false));
  }, []);

  return (
    <section className="text-center">
      <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 sm:text-6xl dark:text-stone-50">
        Your data analyst, on every call.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg dark:text-stone-400">
        DataDonkey joins your meetings, answers data questions in chat, and emails
        the follow-ups you forgot to ask. Plug into the analytics tools you
        already use — your data never leaves them.
      </p>
      <div className="mt-9 flex items-center justify-center gap-4">
        {isAuthed === true ? (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-stone-950"
          >
            Open dashboard
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <>
            <Link
              href="/partner"
              className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-stone-950"
            >
              Connect your data
              <span aria-hidden>→</span>
            </Link>
            {isAuthed === false && (
              <Link
                href="/login"
                className="text-sm font-medium text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              >
                Sign in
              </Link>
            )}
          </>
        )}
      </div>
      <p className="mt-4 text-xs text-stone-500">
        Free for the first 10 design partners.
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps: { color: string; rotate: string; title: string; body: string }[] = [
    {
      color: "bg-emerald-300",
      rotate: "-rotate-3",
      title: "Connect your tool",
      body: "PostHog today; Mixpanel and Amplitude soon.",
    },
    {
      color: "bg-amber-300",
      rotate: "rotate-2",
      title: "Let it join calls",
      body: "Connect your calendar so DataDonkey auto-joins every meeting with a link.",
    },
    {
      color: "bg-rose-300",
      rotate: "-rotate-2",
      title: 'Say "Hey PostHog"',
      body: "Anyone in the call asks a data question — answer lands in chat in seconds.",
    },
    {
      color: "bg-orange-300",
      rotate: "rotate-3",
      title: "Get the follow-ups",
      body: "After every call, a written report with the data points you missed lands in your email + Slack.",
    },
  ];
  return (
    <section className="mt-24">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-orange-700 dark:text-orange-400">
          How it works
        </p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl dark:text-stone-50">
          Four steps. About five minutes.
        </h2>
      </div>
      <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={i}
            className="rounded-2xl border border-stone-200 bg-white/60 p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900/60"
          >
            <span
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${s.color} ${s.rotate} text-base font-extrabold text-stone-900 shadow-sm`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-5 text-base font-semibold text-stone-900 dark:text-stone-100">
              {s.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WhoItsFor() {
  const personas: { headline: string; body: string }[] = [
    {
      headline: "Product managers who live in calls",
      body: "Stop alt-tabbing to the data tool mid-meeting. Stop forgetting follow-ups. Get answers before the conversation moves on.",
    },
    {
      headline: "Founders without a data team",
      body: "Be the data-driven person at the table without hiring an analyst. DataDonkey explores your events for you and reports back.",
    },
    {
      headline: "Teams already in PostHog",
      body: "We use PostHog's MCP — your data stays in your project, you stay in control. No re-instrumentation, no new dashboards.",
    },
  ];
  return (
    <section className="mt-24">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-orange-700 dark:text-orange-400">
          Who it&apos;s for
        </p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl dark:text-stone-50">
          Built for the people on the call.
        </h2>
      </div>
      <ul className="mt-12 grid gap-6 md:grid-cols-3">
        {personas.map((p, i) => (
          <li
            key={i}
            className="rounded-2xl border border-stone-200 bg-amber-50/30 p-6 dark:border-stone-800 dark:bg-amber-950/10"
          >
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {p.headline}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              {p.body}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-12 text-center">
        <RepeatedCTA />
      </div>
    </section>
  );
}

function RepeatedCTA() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setIsAuthed(!!data.user))
      .catch(() => setIsAuthed(false));
  }, []);
  return (
    <Link
      href={isAuthed === true ? "/dashboard" : "/partner"}
      className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700"
    >
      {isAuthed === true ? "Open dashboard" : "Connect your data"}
      <span aria-hidden>→</span>
    </Link>
  );
}
