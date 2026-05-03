import Link from "next/link";

export default function Landing() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-10">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🫏</span>
          <span className="text-lg font-semibold tracking-tight">datadonkey</span>
        </div>
        <nav className="flex items-center gap-5 text-sm text-stone-600 dark:text-stone-400">
          <Link href="/login" className="hover:text-stone-900 dark:hover:text-stone-100">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-sm uppercase tracking-widest text-stone-500">
          A letter from a product manager
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          Your data shouldn&apos;t have to wait for the next sync.
        </h1>

        <div className="mt-10 space-y-6 text-lg leading-relaxed text-stone-700 dark:text-stone-300">
          <p>Hey,</p>
          <p>
            I&apos;m a PM. I spend my whole day on calls. Customer calls,
            standups, design reviews, exec syncs. Every one of them surfaces a
            data question I want answered — <em>right now</em>, not tomorrow,
            not when I get back to my desk and remember it.
          </p>
          <p>
            &ldquo;How many users churned this week?&rdquo;{" "}
            &ldquo;What&apos;s converting on the new pricing page?&rdquo;{" "}
            &ldquo;Where&apos;s the drop-off in onboarding?&rdquo;
          </p>
          <p>
            By the time I open PostHog and the right insight, the moment is
            gone. The decision got made on vibes. Or worse, deferred.
          </p>
          <p className="font-medium text-stone-900 dark:text-stone-100">
            So I built datadonkey.
          </p>
        </div>

        <Section title="The problem">
          <p>
            Product managers — especially the ones who actually look at data —
            live in calls. The data they need lives in PostHog, Mixpanel,
            Amplitude. The two never meet in the moment that matters.
          </p>
          <p>
            You either prep every meeting with five custom queries (you
            won&apos;t), context-switch mid-call (you can&apos;t), or just
            guess (we all do).
          </p>
        </Section>

        <Section title="The solution">
          <p>
            datadonkey is your data analyst on every conference call. Say{" "}
            <Code>Hey PostHog</Code> mid-meeting and a chat reply lands in 5–10
            seconds with the actual number. After the call it reads the
            transcript, finds the data questions you missed, and emails you
            and the participants the answers — with chart links.
          </p>
          <p>
            Your data stays in the tool you already trust. We&apos;re just the
            rail behind the scenes.
          </p>
        </Section>

        <Section title="How it works">
          <ol className="space-y-4 pl-0">
            <Step n={1} title="Pick your data tool">
              PostHog today. Mixpanel and Amplitude as their MCPs ship.
            </Step>
            <Step n={2} title="Drop in your call link">
              Paste a Google Meet, Zoom, or Teams URL. The bot joins as
              &ldquo;PostHog&rdquo; (or whatever tool you picked).
            </Step>
            <Step n={3} title="Talk normally">
              Anyone on the call can say{" "}
              <Code>Hey PostHog, &lt;question&gt;</Code>. The answer arrives
              in chat seconds later — no app-switching, no presenter mode.
            </Step>
            <Step n={4} title="Get the post-call email">
              datadonkey reads the full transcript, surfaces every data
              question that came up, queries the tool, and emails everyone a
              brief: TL;DR, findings with links, what to do next.
            </Step>
          </ol>
        </Section>

        <Section title="The ask">
          <p>
            Free for the first 10 design partners while we shape the product
            with real teams. Pricing: TBD, and probably absurd value for
            anyone running data-driven products.
          </p>
          <p>
            If your team lives in calls and your data lives in PostHog,
            Mixpanel, or Amplitude — give it a try.
          </p>
          <div className="pt-2">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-5 py-3 text-sm font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Become a design partner →
            </Link>
            <p className="mt-3 text-sm text-stone-500">
              Takes about a minute. No credit card.
            </p>
          </div>
        </Section>

        <p className="mt-20 text-sm text-stone-500">
          — Jaryd, building datadonkey
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-500">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-lg leading-relaxed text-stone-700 dark:text-stone-300">
        {children}
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-sm font-medium text-stone-50 dark:bg-stone-100 dark:text-stone-900">
        {n}
      </span>
      <div>
        <div className="font-medium text-stone-900 dark:text-stone-100">{title}</div>
        <div className="mt-1 text-stone-600 dark:text-stone-400">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-[0.95em] text-stone-900 dark:bg-stone-800 dark:text-stone-100">
      {children}
    </code>
  );
}
