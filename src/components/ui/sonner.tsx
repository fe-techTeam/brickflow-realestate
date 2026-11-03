"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck, Info, TriangleAlert, OctagonAlert, Loader2 } from "lucide-react"

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      gap={10}
      offset={20}
      icons={{
        success: <CircleCheck className="size-[1.125rem]" strokeWidth={1.75} />,
        info: <Info className="size-[1.125rem]" strokeWidth={1.75} />,
        warning: <TriangleAlert className="size-[1.125rem]" strokeWidth={1.75} />,
        error: <OctagonAlert className="size-[1.125rem]" strokeWidth={1.75} />,
        loading: <Loader2 className="size-[1.125rem] animate-spin text-fg-muted" strokeWidth={1.75} />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
          "--width": "380px",
        } as React.CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: "bf-toast",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
