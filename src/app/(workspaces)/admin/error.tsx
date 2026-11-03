"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="mx-auto mt-10 max-w-xl animate-fade-up rounded-xl border border-border/90 bg-card px-6 py-12 text-center shadow-[0_24px_48px_-36px_rgba(8, 14, 24,0.45)]">
      <span className="relative mx-auto mb-6 flex size-16 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-full border border-danger/30" />
        <span aria-hidden="true" className="absolute inset-2 rounded-full bg-danger-soft" />
        <AlertTriangle className="relative size-5 text-danger" strokeWidth={1.5} />
      </span>
      <h1 className="text-[1.75rem] font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong while loading the admin console. No changes were made. Try again, or return to the dashboard.
      </p>
      {digest && <p className="mt-3 font-mono text-[0.7rem] text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Button variant="outline" asChild className="bg-card">
          <Link href="/admin">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
