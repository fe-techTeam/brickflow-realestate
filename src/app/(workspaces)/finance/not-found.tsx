import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/panels";
import { Button } from "@/components/ui/button";

export default function FinanceNotFound() {
  return (
    <div className="surface mx-auto max-w-xl animate-fade-up">
      <EmptyState
        icon={SearchX}
        title="Record not found"
        description="It may not exist, or it belongs to a programme outside Veefin's portfolio."
        action={
          <Button asChild variant="outline">
            <Link href="/finance/requests">Go to financing requests</Link>
          </Button>
        }
      />
    </div>
  );
}
