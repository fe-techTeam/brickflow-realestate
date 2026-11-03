import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "./_components/editorial";

export default function AdminNotFound() {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl border border-border/90 bg-card shadow-[0_24px_48px_-36px_rgba(34, 45, 43,0.45)]">
      <Empty
        icon={SearchX}
        title="Record not found"
        description="The record you are looking for does not exist or has been removed."
        action={
          <Button variant="outline" asChild className="bg-card">
            <Link href="/admin">Back to the overview</Link>
          </Button>
        }
      />
    </div>
  );
}
