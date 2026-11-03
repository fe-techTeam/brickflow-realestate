"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BuilderError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="mx-auto mt-6 max-w-xl animate-fade-up rounded-xl border border-[#e7e1d3] bg-card px-6 py-12 text-center shadow-[0_22px_44px_-32px_rgba(20,43,67,0.28)] sm:px-10">
      <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-[#f8e7e4] text-[#93342a] ring-1 ring-[#ecc6bf]">
        <AlertTriangle className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="font-display text-[1.75rem] font-semibold text-navy">This page could not be loaded</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Something went wrong while loading your builder workspace. No changes were made. Try again, or return to the overview.
      </p>
      {digest && <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/builder">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
