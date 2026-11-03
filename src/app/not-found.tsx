import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusScreen } from "@/components/brand/status-screen";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      eyebrow="Page not found"
      title="This address is not on the register"
      description="The page you asked for does not exist, has moved, or belongs to a workspace you do not have access to."
      note="If you followed a link from a notification, the record it pointed to may have been withdrawn."
      actions={
        <Button asChild size="lg" className="group/cta">
          <Link href="/">
            Return to your workspace
            <ArrowRight className="text-kota-300 transition-transform duration-200 group-hover/cta:translate-x-0.5" />
          </Link>
        </Button>
      }
    />
  );
}
