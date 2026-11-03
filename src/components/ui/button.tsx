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
          "border-navy-900 bg-navy bg-gradient-to-b from-navy-700 to-navy text-white shadow-button hover:from-navy-600 hover:to-navy-700 active:from-navy active:to-navy-900",
        gold:
          "border-gold-600/70 bg-gold bg-gradient-to-b from-gold-300 to-gold text-navy-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(106_84_48/0.25),0_6px_14px_-6px_rgb(169_138_82/0.55)] hover:from-gold-200 hover:to-gold-400 active:from-gold active:to-gold-600",
        success:
          "border-heritage-800 bg-heritage bg-gradient-to-b from-heritage-600 to-heritage text-white shadow-button hover:from-heritage-500 hover:to-heritage-600 active:from-heritage active:to-heritage-800",
        outline:
          "border-input bg-card text-navy shadow-xs hover:border-navy/25 hover:bg-ivory-50 hover:text-navy aria-expanded:border-navy/25 aria-expanded:bg-ivory-50",
        secondary:
          "border-ivory-300/70 bg-secondary text-secondary-foreground hover:bg-ivory-300/70 aria-expanded:bg-ivory-300/70",
        ghost: "text-slate-ink hover:bg-ivory-200/70 hover:text-navy aria-expanded:bg-ivory-200/70 aria-expanded:text-navy",
        destructive:
          "border-danger/15 bg-danger-soft text-danger hover:border-danger/30 hover:bg-[#f3dcd6] focus-visible:ring-destructive/25",
        link: "h-auto px-0 text-navy underline decoration-gold/60 underline-offset-4 hover:decoration-gold",
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
