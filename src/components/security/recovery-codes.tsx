"use client";

import { useState } from "react";
import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One-time display of freshly generated recovery codes, with copy and download. */
export function RecoveryCodesList({ codes, email }: { codes: string[]; email?: string }) {
  const [copied, setCopied] = useState(false);
  const text = [`BrickFlow recovery codes${email ? ` for ${email}` : ""}`, `Generated ${new Date().toLocaleString("en-IN")}`, "Each code works once.", "", ...codes].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "brickflow-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/10 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-soft">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
        Save these codes somewhere safe now. They will not be shown again. Each one signs you in once if you lose access to your authenticator app.
      </p>
      <ol className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-glass-50 p-4 font-mono text-[0.875rem] tracking-[0.06em] text-fg sm:grid-cols-2" aria-label="Recovery codes">
        {codes.map((code, i) => (
          <li key={code} className="flex items-baseline gap-3">
            <span className="w-5 text-right text-[0.6875rem] text-fg-muted tabular">{i + 1}.</span>
            <span className="select-all">{code}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="size-3.5" />
          Download .txt
        </Button>
      </div>
    </div>
  );
}
