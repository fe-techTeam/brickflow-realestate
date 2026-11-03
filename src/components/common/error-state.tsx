import type { ReactNode } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Returns the server error digest Next.js attaches to errors, or undefined. */
export function errorDigest(error: unknown): string | undefined {
  if (error && typeof error === "object" && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest) return digest;
  }
  return undefined;
}

/**
 * In-workspace failure card for `error.tsx` boundaries. Pass `onRetry` (the boundary's `retry`)
 * and a `back` link; `error` is only used to show its digest as a support reference.
 */
export function ErrorState({
  title = "This page could not be loaded",
  description = "Something went wrong while loading this view. No changes were made. Try again, or return to the overview.",
  error,
  onRetry,
  back,
  icon: Icon = TriangleAlert,
  actions,
  className,
}: {
  title?: string;
  description?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  back?: { href: string; label: string };
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  const digest = errorDigest(error);
  return (
    <div role="alert" className={cn("surface relative mx-auto mt-6 max-w-xl animate-fade-up overflow-hidden px-6 py-12 text-center sm:px-10", className)}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-danger/0 via-danger/70 to-danger/0" />
      <span className="relative mx-auto mb-6 flex size-14 items-center justify-center">
        <span aria-hidden="true" className="absolute -inset-3 rounded-full border border-dashed border-danger/25" />
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-danger-soft ring-1 ring-danger/15" />
        <Icon className="relative size-5 text-danger" strokeWidth={1.6} />
      </span>
      <h1 className="font-display text-[1.5rem] leading-tight font-medium tracking-[-0.01em] text-basalt">{title}</h1>
      <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {(onRetry || back || actions) && (
        <div className="mt-8 flex flex-col-reverse justify-center gap-2.5 sm:flex-row">
          {back && (
            <Button variant="outline" asChild>
              <Link href={back.href}>{back.label}</Link>
            </Button>
          )}
          {actions}
          {onRetry && (
            <Button onClick={() => onRetry()}>
              <RotateCw className="text-kota-300" />
              Try again
            </Button>
          )}
        </div>
      )}
      {digest && (
        <p className="mt-7 text-[0.6875rem] text-muted-foreground">
          Reference <span className="figure ml-1 rounded bg-paper-100 px-1.5 py-0.5 text-basalt ring-1 ring-paper-300">{digest}</span>
        </p>
      )}
    </div>
  );
}
