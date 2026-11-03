"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { StatusScreen } from "@/components/brand/status-screen";
import { Button } from "@/components/ui/button";
import { errorDigest } from "@/components/common/error-state";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="500"
      tone="danger"
      eyebrow="Unexpected error"
      title="Something interrupted this page"
      description="BrickFlow could not finish loading this view. No transaction was changed. Try again, or return to your workspace."
      reference={errorDigest(error)}
      actions={
        <>
          <Button size="lg" onClick={() => retry()}>
            <RotateCw className="text-kota-300" />
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">Return to your workspace</Link>
          </Button>
        </>
      }
    />
  );
}
