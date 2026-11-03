"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FinanceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[finance] page failed to render", error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="surface mx-auto flex max-w-xl animate-fade-up flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning ring-1 ring-[#efd9ae]">
        <AlertTriangle className="size-5" strokeWidth={1.6} />
      </span>
      <p className="eyebrow mb-2 text-gold-600">Veefin Finance</p>
      <h1 className="text-2xl font-semibold">This view could not be loaded</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Something went wrong while preparing this page. No changes were made to any financing request. Try again, or return to the overview.
      </p>
      {digest && <p className="tabular mt-3 text-xs text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/finance">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
