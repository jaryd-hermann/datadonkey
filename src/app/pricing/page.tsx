"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AppShell } from "@/components/AppShell";

interface Conn {
  isPartner: boolean;
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
}

export default function Pricing() {
  const [conn, setConn] = useState<Conn | null>(null);

  useEffect(() => {
    fetch("/api/connection")
      .then((r) => r.json())
      .then((j) => setConn(j))
      .catch(() => {});
  }, []);

  const isPartner = !!conn?.isPartner;

  return (
    <AppShell
      showAppNav={!!conn?.userName}
      user={
        conn?.userName
          ? { name: conn.userName, company: conn.userCompany, email: conn.userEmail }
          : null
      }
    >
      <div className="mx-auto max-w-5xl px-6 py-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          {isPartner && (
            <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              Design partner
            </span>
          )}
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50 sm:text-5xl">
            Bring DataDonkey to every meeting.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-stone-600 dark:text-stone-400">
            Two simple plans. No setup fees, cancel any time. Plans are per
            user — your team can scale up or down monthly.
          </p>
        </motion.div>

        {isPartner && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-6 py-5 text-center dark:border-emerald-700 dark:bg-emerald-950/30">
            <div className="text-base font-bold text-emerald-900 dark:text-emerald-100">
              You&apos;re getting this for free right now.
            </div>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
              As a design partner, both plans are on us during the private beta.
              Keep the feedback coming and we&apos;ll lock in preferred pricing
              when we exit beta.
            </p>
          </div>
        )}

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Plan
            name="Builder"
            price={20}
            cadence="/user/month"
            blurb="For PMs who run a few key meetings a week and want sharp follow-ups."
            features={[
              "Up to 5 meetings per user per week",
              "Live 'Hey PostHog' answers in calls",
              "Smart fast-follow report after each meeting",
              "Slack DM + email delivery",
              "Personal API key or Sign in with PostHog",
              "Calendar auto-join (Google)",
            ]}
            ctaLabel="Choose Builder"
            highlight={false}
            disabled={isPartner}
          />
          <Plan
            name="Operator"
            price={50}
            cadence="/user/month"
            blurb="For teams that live in meetings and want every signal captured."
            features={[
              "Unlimited meetings per user",
              "Everything in Builder",
              "Priority MCP queries (4-question depth)",
              "Per-meeting usage analytics",
              "Conversational Slack bot for ad-hoc questions",
              "Premium support, direct line to the team",
            ]}
            ctaLabel="Choose Operator"
            highlight
            disabled={isPartner}
            badge="Most popular"
          />
        </div>

        <FAQ />

        <div className="mt-16 text-center text-xs text-stone-500">
          Pricing in USD. Stripe checkout coming soon — for now we&apos;ll
          invoice by email when you upgrade.
        </div>
      </div>
    </AppShell>
  );
}

function Plan({
  name,
  price,
  cadence,
  blurb,
  features,
  ctaLabel,
  highlight,
  disabled,
  badge,
}: {
  name: string;
  price: number;
  cadence: string;
  blurb: string;
  features: string[];
  ctaLabel: string;
  highlight: boolean;
  disabled: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-7 shadow-sm transition ${
        highlight
          ? "border-2 border-orange-500 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 dark:border-orange-500/60 dark:from-orange-950/20 dark:via-amber-950/10 dark:to-rose-950/10"
          : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
      }`}
    >
      {badge && (
        <span className="absolute -top-3 left-7 inline-flex items-center rounded-full bg-orange-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow">
          {badge}
        </span>
      )}
      <h3 className="text-2xl font-bold text-stone-900 dark:text-stone-100">
        {name}
      </h3>
      <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">{blurb}</p>
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-5xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50">
          ${price}
        </span>
        <span className="text-sm text-stone-500">{cadence}</span>
      </div>
      <ul className="mt-6 flex-1 space-y-2.5 text-sm text-stone-700 dark:text-stone-300">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckIcon highlight={highlight} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          alert(
            `Stripe checkout will open here for the ${name} plan. We're building this next — for now, drop hermannjaryd@gmail.com a line and we'll set it up manually.`,
          );
        }}
        className={`mt-7 w-full rounded-lg px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          highlight
            ? "bg-orange-600 text-white hover:bg-orange-700"
            : "bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        }`}
      >
        {disabled ? "Free as a design partner" : ctaLabel}
      </button>
    </div>
  );
}

function CheckIcon({ highlight }: { highlight: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-0.5 shrink-0 ${highlight ? "text-orange-600" : "text-emerald-500"}`}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function FAQ() {
  const items = [
    {
      q: "What counts as a 'meeting'?",
      a: "Any call you invite DataDonkey to — Google Meet, Zoom, or Teams. We count it as one meeting per call regardless of length.",
    },
    {
      q: "Do my data tool queries count against my PostHog/Mixpanel quota?",
      a: "Yes — DataDonkey reads from your data tool through their MCP, so queries count against your normal data-tool plan. For PostHog this is usually rounding error.",
    },
    {
      q: "Who pays for the AI?",
      a: "We do — Anthropic API costs are baked into the plan price. You don't bring your own keys.",
    },
    {
      q: "Can I cancel any time?",
      a: "Yes. Month-to-month, no contracts. Annual plans (with a discount) coming soon.",
    },
    {
      q: "Will my data be used to train models?",
      a: "No. Your transcripts and answers are sent to Anthropic with their no-training default and stored only on our infrastructure for the lifetime of the meeting record.",
    },
  ];
  return (
    <section className="mx-auto mt-16 max-w-3xl">
      <h2 className="text-center text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Frequently asked
      </h2>
      <dl className="mt-6 space-y-4">
        {items.map((it) => (
          <details
            key={it.q}
            className="group rounded-xl border border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-900"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-stone-900 dark:text-stone-100">
              {it.q}
              <span className="float-right text-stone-400 group-open:rotate-180 inline-block transition">
                ⌄
              </span>
            </summary>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              {it.a}
            </p>
          </details>
        ))}
      </dl>
    </section>
  );
}
