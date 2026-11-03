import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * BrickFlow mark: three towers on a gulmohar waterline with its reflection —
 * real estate made liquid. Self-contained basalt tile, legible on light and dark surfaces.
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2d3b4f" />
          <stop offset="1" stopColor="#182231" />
        </linearGradient>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffc247" stopOpacity="0.4" />
          <stop offset="0.5" stopColor="#ffd57c" />
          <stop offset="1" stopColor="#ffc247" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill={`url(#${id}-tile)`} />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="0.75" />
      <rect x="8" y="14.5" width="4.25" height="8.75" rx="0.6" fill="#f5f8fb" fillOpacity="0.55" />
      <rect x="13.75" y="7.5" width="4.5" height="15.75" rx="0.6" fill="#f5f8fb" />
      <rect x="19.75" y="11.5" width="4.25" height="11.75" rx="0.6" fill="#f5f8fb" fillOpacity="0.8" />
      <path d="M14.9 10.5h2.2M14.9 13.25h2.2M14.9 16h2.2M14.9 18.75h2.2" stroke="#1f2a3a" strokeWidth="0.85" strokeLinecap="round" />
      <path d="M6 24.75h20" stroke={`url(#${id}-water)`} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 27.25h12" stroke="#ffc247" strokeOpacity="0.45" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

const SIZES = {
  sm: { mark: "size-7", word: "text-[1.2rem]", tag: "text-[0.55rem]" },
  md: { mark: "size-8", word: "text-[1.4rem]", tag: "text-[0.6rem]" },
  lg: { mark: "size-11", word: "text-[1.95rem]", tag: "text-[0.66rem]" },
} as const;

export function Logo({
  className,
  tone = "dark",
  showTagline = false,
  size = "md",
}: {
  className?: string;
  tone?: "dark" | "light";
  showTagline?: boolean;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  return (
    <div className={cn("flex items-center gap-3", tone === "light" ? "text-white" : "text-fg", className)}>
      <LogoMark className={s.mark} />
      <div className="leading-none">
        <span className={cn("font-display font-normal tracking-[-0.02em]", s.word)}>
          Brick
          <span className={cn("font-medium italic", tone === "light" ? "text-signal-300" : "text-signal-600")}>Flow</span>
        </span>
        {showTagline && (
          <span className={cn("mt-1.5 block font-medium tracking-[0.22em] uppercase", s.tag, tone === "light" ? "text-white/55" : "text-muted-foreground")}>
            Real Estate Receivables, Made Liquid
          </span>
        )}
      </div>
    </div>
  );
}
