"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { AppShell } from "@/components/AppShell";

const VALID_CODES = ["iwantdonkey"];
const CONTACT_EMAIL = "hermannjaryd@gmail.com";

function celebrate() {
  if (typeof window === "undefined") return;
  const colors = ["#EA580C", "#F59E0B", "#FBBF24", "#10B981", "#3B82F6"];
  const common = { particleCount: 80, spread: 80, startVelocity: 50, colors, ticks: 220 };
  confetti({ ...common, origin: { x: 0, y: 0 }, angle: -45 });
  confetti({ ...common, origin: { x: 1, y: 0 }, angle: 225 });
  confetti({ ...common, origin: { x: 0, y: 1 }, angle: 45 });
  confetti({ ...common, origin: { x: 1, y: 1 }, angle: 135 });
}

export default function PartnerGate() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = code.trim().toLowerCase();
    if (!VALID_CODES.includes(normalized)) {
      setError("That code didn't work. Try again or apply to be a design partner below.");
      return;
    }
    // Server-set cookie is more reliable than document.cookie across the
    // middleware-redirected navigation that follows.
    const r = await fetch("/api/partner/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: normalized }),
    });
    if (!r.ok) {
      setError("That code didn't work. Try again or apply to be a design partner below.");
      return;
    }
    try {
      localStorage.setItem("partner_verified", "1");
      localStorage.setItem("partner_code", normalized);
    } catch {}
    setVerified(true);
    celebrate();
    // Hard navigation so the freshly-set cookie ships with the request.
    setTimeout(() => {
      window.location.href = "/signup";
    }, 1600);
  }

  // If they already verified once on this device, surface that visibly
  // rather than silently teleporting them past the gate — otherwise it
  // looks like the gate is broken when a 30-day-old cookie is present.
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  useEffect(() => {
    if (typeof document !== "undefined" && document.cookie.includes("partner_verified=1")) {
      setAlreadyVerified(true);
    }
  }, []);

  function copyEmail() {
    navigator.clipboard.writeText(CONTACT_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <span className="inline-block rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
            Design partners only
          </span>
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl">
            DataDonkey is in private beta.
          </h1>
          <p className="mt-4 text-base text-stone-700 dark:text-stone-300">
            We&apos;re only working with a handful of design partners right now —
            data-driven product folks who want a smarter analyst on every call
            and are willing to give honest feedback while we sharpen it.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
              <div className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                What you get
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-stone-700 dark:text-stone-300">
                <li>• Free, the entire beta</li>
                <li>• Direct line to the team</li>
                <li>• First crack at new features</li>
                <li>• Lifetime preferred pricing post-beta</li>
              </ul>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
              <div className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                What we ask
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-stone-700 dark:text-stone-300">
                <li>• Use it for real meetings</li>
                <li>• Honest feedback when it&apos;s rough</li>
                <li>• A 20-min call now and again</li>
                <li>• Tell a friend if it&apos;s working</li>
              </ul>
            </div>
          </div>

          {alreadyVerified && !verified && (
            <div className="mt-8 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="text-base font-bold">✓ You&apos;re already verified.</div>
              <p className="mt-1 text-sm">
                You signed up as a design partner on this device before. Pick
                up where you left off:
              </p>
              <a
                href="/signup"
                className="mt-3 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Continue to signup →
              </a>
            </div>
          )}

          {!verified && !alreadyVerified && (
            <form
              onSubmit={submit}
              className="mt-8 rounded-2xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 p-6 dark:border-orange-500/40 dark:from-orange-950/20 dark:to-amber-950/10"
            >
              <label className="text-sm font-medium text-stone-900 dark:text-stone-100">
                Got an invite code?
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="invite code"
                  autoFocus
                  className="flex-1 rounded-md border-2 border-stone-200 bg-white px-3 py-2 text-base font-mono text-stone-900 focus:border-orange-500 focus:outline-none dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                />
                <button
                  type="submit"
                  className="rounded-md bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Verify →
                </button>
              </div>
              {error && (
                <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
                  {error}
                </div>
              )}
            </form>
          )}

          {verified && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-100"
            >
              <div className="text-base font-bold">🎉 You&apos;re in.</div>
              <div className="mt-1 text-sm">
                Verified as a design partner. Sending you to signup…
              </div>
              <a
                href="/signup"
                className="mt-3 inline-block text-sm font-semibold underline hover:no-underline"
              >
                Or click here to continue →
              </a>
            </motion.div>
          )}

          <div className="mt-10 border-t border-stone-200 pt-8 dark:border-stone-800">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Don&apos;t have a code?
            </h2>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              Want to be a design partner? Drop us a line and tell us a bit
              about your team. We pick a few each week.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=DataDonkey design partner&body=Hi%20Jaryd%2C%0A%0AI%27d%20like%20to%20be%20a%20DataDonkey%20design%20partner.%20Quick%20bit%20about%20me%3A%0A%0A-%20Role%3A%0A-%20Company%3A%0A-%20What%20we%27d%20use%20it%20for%3A%0A-%20What%20I%27d%20want%20to%20see%20answered%20in%20meetings%3A%0A%0AThanks%21`}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                Become a design partner
              </a>
              <button
                type="button"
                onClick={copyEmail}
                className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
              >
                {copied ? "Copied!" : `Or copy ${CONTACT_EMAIL}`}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AppShell>
  );
}
