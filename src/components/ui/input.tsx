import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-white/20 bg-black/60 px-4 py-2 text-sm text-white shadow-inner-light backdrop-blur-md file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all font-medium",
          error 
            ? "border-fail/50 focus-visible:ring-fail/80 shadow-[0_0_15px_rgba(244,63,94,0.2)]" 
            : "focus-visible:ring-violet-400 focus-visible:shadow-glow-primary hover:border-white/30",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
