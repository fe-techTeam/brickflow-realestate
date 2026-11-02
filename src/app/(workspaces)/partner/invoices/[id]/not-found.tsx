import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/common/panels";
import { Button } from "@/components/ui/button";

export default function InvoiceNotFound() {
  return (
    <div className="surface mx-auto mt-6 max-w-xl animate-fade-up">
      <EmptyState
        icon={FileQuestion}
        title="Invoice not found"
        description="This invoice doesn't exist or isn't part of your organisation's records."
        action={
          <Button asChild>
            <Link href="/partner/invoices">Back to My Invoices</Link>
          </Button>
        }
      />
    </div>
  );
}
