"use client";

// Reproduces PostHog's signature beveled "Sign in" button look (cream
// fill, dark-gold border-bottom, brown text). Currently a no-op with a
// "Coming very soon" tooltip on hover — flip `comingSoon={false}` once
// PostHog Cloud supports CIMD or we have a registered client_id.

interface Props {
  href?: string;
  comingSoon?: boolean;
  badge?: string; // e.g. "~5x faster"
}

export function PosthogConnectButton({
  href,
  comingSoon = true,
  badge,
}: Props) {
  const sharedClasses =
    "group relative inline-flex w-full items-center justify-center gap-2 select-none";

  const inner = (
    <span
      className="
        relative flex w-full items-center justify-center gap-2
        rounded-md
        border-2 border-[#b17816]
        bg-[#fef0c8] dark:bg-[#fef0c8]
        px-4 py-3 pb-3.5
        text-sm font-bold text-[#3a2200] dark:text-[#3a2200]
        shadow-[0_3px_0_0_#b17816]
        transition-[transform,box-shadow]
        group-hover:translate-y-[1px] group-hover:shadow-[0_2px_0_0_#8e5b03]
        group-active:translate-y-[3px] group-active:shadow-[0_0_0_0_#8e5b03]
      "
    >
      <img
        src="/posthogicon.png"
        alt=""
        className="h-4 w-4 object-contain"
      />
      <span>Continue with PostHog</span>
      {badge && (
        <span className="rounded-full bg-[#b17816]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#3a2200]">
          {badge}
        </span>
      )}
    </span>
  );

  // Tooltip — pure CSS hover, no extra JS. Sits above the button.
  const tooltip = comingSoon ? (
    <span
      className="
        pointer-events-none absolute -top-9 left-1/2 z-10
        -translate-x-1/2 rounded-md
        bg-stone-900 px-2 py-1 text-[11px] font-medium text-white
        opacity-0 shadow-lg transition-opacity
        group-hover:opacity-100
        dark:bg-stone-100 dark:text-stone-900
      "
    >
      Coming very soon
      <span
        className="
          absolute left-1/2 top-full -translate-x-1/2 -translate-y-px
          border-4 border-transparent border-t-stone-900
          dark:border-t-stone-100
        "
      />
    </span>
  ) : null;

  if (comingSoon) {
    return (
      <button
        type="button"
        disabled
        className={`${sharedClasses} cursor-not-allowed`}
        aria-disabled
      >
        {tooltip}
        {inner}
      </button>
    );
  }
  return (
    <a href={href} className={sharedClasses}>
      {tooltip}
      {inner}
    </a>
  );
}
