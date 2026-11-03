import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-card shadow-xs transition-[border-color,box-shadow,background-color] duration-200 outline-none placeholder:text-muted-foreground/80 hover:border-navy/25 focus-visible:border-gold focus-visible:ring-3 focus-visible:ring-gold/20 px-3 py-2.5 text-base leading-relaxed disabled:cursor-not-allowed disabled:bg-ivory-100 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
