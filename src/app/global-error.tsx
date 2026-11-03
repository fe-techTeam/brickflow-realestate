"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { StatusScreen } from "@/components/brand/status-screen";
import { Button } from "@/components/ui/button";
import { errorDigest } from "@/components/common/error-state";
import { fontVariables } from "@/styles/fonts";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="min-h-screen">
        <title>Unavailable · BrickFlow</title>
        <StatusScreen
          code="503"
          tone="danger"
          eyebrow="Service unavailable"
          title="BrickFlow is briefly unavailable"
          description="The application could not start this view. No transaction was changed. Please try again in a moment."
          reference={errorDigest(error)}
          actions={
            <>
              <Button size="lg" onClick={() => retry()}>
                <RotateCw className="text-gold-300" />
                Try again
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/">Return to your workspace</Link>
              </Button>
            </>
          }
        />
      </body>
    </html>
  );
}
