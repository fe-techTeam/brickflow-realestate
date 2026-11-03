"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PartnerError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[partner] page failed to render", error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="surface mx-auto mt-10 max-w-xl animate-fade-up px-6 py-14 text-center sm:px-10">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#f8e7e4] text-danger">
        <AlertTriangle className="size-5" strokeWidth={1.6} />
      </span>
      <h1 className="mt-5 font-display text-[1.75rem] font-medium">We couldn&apos;t load this page</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Something went wrong while loading your workspace data. Your invoices and requests are safe — please try again.
      </p>
      {digest && <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-7 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <Button variant="outline" asChild>
          <Link href="/partner">Back to overview</Link>
        </Button>
        <Button onClick={() => retry()}>
          <RotateCw />
          Try again
        </Button>
      </div>
    </div>
  );
}
