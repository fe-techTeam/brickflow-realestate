"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addInternalCommentAction } from "@/server/actions/financing";

export function InternalCommentForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim().length < 2) {
      setError("Write a comment of at least 2 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addInternalCommentAction(requestId, { body: body.trim() });
      if (!result.ok) {
        setError(result.fieldErrors?.body?.[0] ?? result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Internal comment added.");
      setBody("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <Label htmlFor="internal-comment" className="sr-only">
        Internal comment
      </Label>
      <Textarea
        id="internal-comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a private annotation for the credit team…"
        rows={3}
        maxLength={2000}
        disabled={pending}
        aria-invalid={Boolean(error)}
        aria-describedby="internal-comment-hint"
        className="min-h-24 resize-y border-border bg-card text-[0.875rem] leading-relaxed shadow-none focus-visible:border-line-strong"
      />
      <div className="flex items-center justify-between gap-3">
        <p id="internal-comment-hint" className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" />
          Shared with Veefin users only
        </p>
        <Button type="submit" size="sm" className="px-3.5" disabled={pending || body.trim().length === 0}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Add annotation
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
