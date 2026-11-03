import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CARD, Empty } from "../../_components/kit";

export default function InvoiceNotFound() {
  return (
    <div className={`${CARD} mx-auto mt-6 max-w-xl animate-fade-up`}>
      <Empty
        icon={FileQuestion}
        title="Invoice not found"
        description="This invoice does not exist or was not submitted to your organisation."
        action={
          <Button asChild>
            <Link href="/builder/approvals">Back to invoice approvals</Link>
          </Button>
        }
      />
    </div>
  );
}
