"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resubmitInvoiceAction } from "@/server/actions/invoices";

const MAX_BYTES = 10 * 1024 * 1024;

export function ClarificationResponse({ invoiceId, builderName }: { invoiceId: string; builderName: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ note?: string; file?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function chooseFile(selected: File | undefined) {
    if (!selected) return;
    const problem =
      selected.size === 0
        ? "The selected file is empty"
        : selected.size > MAX_BYTES
          ? "The PDF must be 10 MB or smaller"
          : !(selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf"))
            ? "Only PDF documents are accepted"
            : undefined;
    setErrors((e) => ({ ...e, file: problem }));
    setFile(problem ? null : selected);
    if (problem && input.current) input.current.value = "";
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (note.trim().length < 10) {
      setErrors({ note: "Explain what was clarified (at least 10 characters)" });
      document.getElementById("clarification-note")?.focus();
      return;
    }
    setErrors({});
    const formData = new FormData();
    formData.set("note", note.trim());
    if (file) formData.set("file", file);
    startTransition(async () => {
      const result = await resubmitInvoiceAction(invoiceId, formData);
      if (!result.ok) {
        setErrors({ note: result.fieldErrors?.note?.[0], file: result.fieldErrors?.file?.[0], form: result.error });
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Clarification sent.");
      setNote("");
      setFile(null);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="clarification-note">
          Your response to {builderName}
          <span className="text-destructive"> *</span>
        </Label>
        <Textarea
          id="clarification-note"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (errors.note) setErrors((x) => ({ ...x, note: undefined }));
          }}
          rows={4}
          maxLength={1000}
          placeholder="Describe what you have clarified or corrected, e.g. 'Attached the registered agreement; brokerage slab is 2% as per schedule B.'"
          aria-invalid={Boolean(errors.note)}
          aria-describedby="clarification-note-hint"
          disabled={pending}
          className="bg-card"
        />
        <p id="clarification-note-hint" className={errors.note ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={errors.note ? "alert" : undefined}>
          {errors.note ?? `${note.length}/1000 · minimum 10 characters`}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="clarification-file">Replacement invoice PDF (optional)</Label>
        {file ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-paper/50 px-3 py-2">
            <FileText className="size-4 text-kota-600" />
            <span className="min-w-0 flex-1 truncate text-sm text-basalt">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setFile(null);
                if (input.current) input.current.value = "";
              }}
              aria-label="Remove replacement PDF"
              disabled={pending}
            >
              <X />
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="w-fit" onClick={() => input.current?.click()} disabled={pending}>
            <Paperclip />
            Attach PDF
          </Button>
        )}
        <input
          ref={input}
          id="clarification-file"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => chooseFile(e.target.files?.[0])}
          aria-invalid={Boolean(errors.file)}
        />
        {errors.file && (
          <p role="alert" className="text-xs text-destructive">
            {errors.file}
          </p>
        )}
      </div>

      {errors.form && !errors.note && !errors.file && (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Send clarification
        </Button>
      </div>
    </form>
  );
}
