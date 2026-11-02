import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect x="1" y="1" width="30" height="30" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="6" y="19" width="9" height="6" rx="1" fill="#C4A46A" />
      <rect x="17" y="19" width="9" height="6" rx="1" fill="currentColor" opacity="0.85" />
      <rect x="11.5" y="12" width="9" height="6" rx="1" fill="currentColor" opacity="0.85" />
      <path d="M17 7.5h8.5V16" fill="none" stroke="#C4A46A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25.5 7.5 19 14" fill="none" stroke="#C4A46A" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, tone = "dark", showTagline = false }: { className?: string; tone?: "dark" | "light"; showTagline?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", tone === "light" ? "text-white" : "text-navy", className)}>
      <LogoMark />
      <div className="leading-none">
        <span className="font-display text-[1.45rem] font-semibold tracking-tight">
          Brick<span className="text-gold">Flow</span>
        </span>
        {showTagline && (
          <span className={cn("mt-1 block text-[0.65rem] tracking-[0.18em] uppercase", tone === "light" ? "text-white/60" : "text-muted-foreground")}>
            Real Estate Receivables, Made Liquid
          </span>
        )}
      </div>
    </div>
  );
}
