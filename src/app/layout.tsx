import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fontVariables } from "@/styles/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BrickFlow — Real Estate Receivables, Made Liquid", template: "%s · BrickFlow" },
  description: "Channel partner invoice approval and early-payment financing for real estate builders.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#34435a",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered per request so Next.js can stamp the CSP nonce from src/proxy.ts on its scripts.
  await connection();
  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="min-h-screen">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="top-right" closeButton />
      </body>
    </html>
  );
}
