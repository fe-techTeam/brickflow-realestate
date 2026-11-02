import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/panels";
import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="surface mx-auto mt-6 max-w-xl">
      <EmptyState
        icon={SearchX}
        title="Record not found"
        description="The record you are looking for does not exist or has been removed."
        action={
          <Button variant="outline" asChild>
            <Link href="/admin">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
