import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { Loader2 } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-glow-primary border border-white/10 hover:brightness-110",
        secondary: "bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 shadow-inner-light",
        ghost: "hover:bg-white/5 text-slate-400 hover:text-slate-100",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, onClick, ...props }, ref) => {
    const isDisabled = disabled || loading
    
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }), isDisabled && "pointer-events-none opacity-50")}
          ref={ref}
          {...props}
          aria-busy={loading || undefined}
          aria-disabled={isDisabled || undefined}
          data-disabled={isDisabled || undefined}
          tabIndex={isDisabled ? -1 : undefined}
          onClick={isDisabled ? (event: React.MouseEvent<HTMLElement>) => {
            event.preventDefault()
            event.stopPropagation()
          } : onClick}
        >
          {children}
        </Slot>
      )
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        onClick={onClick}
        {...props}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
