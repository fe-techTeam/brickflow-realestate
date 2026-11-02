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
    <div className="surface mx-auto mt-6 max-w-xl animate-fade-up px-6 py-10 text-center">
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#f8e7e4] text-[#93342a]">
        <AlertTriangle className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="text-2xl font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong while loading the admin console. No changes were made. Try again, or return to the dashboard.
      </p>
      {digest && <p className="mt-3 font-mono text-[0.7rem] text-muted-foreground">Reference: {digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
