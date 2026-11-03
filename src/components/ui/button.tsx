import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium tracking-[0.005em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out-soft outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/45 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px active:not-aria-[haspopup]:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-white/10 bg-white/[0.14] text-white shadow-xs hover:bg-white/[0.2] active:bg-white/[0.1]",
        accent:
          "border-signal-600/60 bg-signal-500 font-semibold text-[#1e2733] shadow-[0_1px_2px_rgb(8_14_24/0.25)] hover:bg-signal-400 active:bg-signal-600",
        success:
          "border-leaf-300/60 bg-leaf-300 text-white shadow-xs hover:bg-leaf active:bg-leaf-300",
        outline:
          "border-line-strong bg-transparent text-fg hover:border-white/30 hover:bg-glass-100 aria-expanded:bg-glass-100",
        secondary:
          "border-line/70 bg-secondary text-secondary-foreground hover:bg-glass-300/70 aria-expanded:bg-glass-300/70",
        ghost: "text-fg-soft hover:bg-glass-200/70 hover:text-fg aria-expanded:bg-glass-200/70 aria-expanded:text-fg",
        destructive:
          "border-danger/25 bg-danger-soft text-danger hover:border-danger/40 hover:bg-danger/20 focus-visible:ring-destructive/25",
        link: "h-auto px-0 text-fg underline decoration-fg-muted/60 underline-offset-4 hover:decoration-fg-muted",
      },
      size: {
        default: "h-9 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-[0.8125rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 rounded-lg px-6 text-[0.9375rem] has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-10 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
