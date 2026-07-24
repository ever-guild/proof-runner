import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Check, X, Loader2, Clock, AlertTriangle, AlertOctagon, XCircle } from "lucide-react"

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider transition-colors shadow-sm",
  {
    variants: {
      variant: {
        pass: "bg-pass/10 border border-pass/30 text-pass shadow-inner-pass",
        fail: "bg-fail/10 border border-fail/30 text-fail shadow-inner-fail",
        running: "bg-running/10 border border-running/30 text-running shadow-inner-running",
        queued: "bg-white/5 border border-white/10 text-slate-400 shadow-inner-light",
        inconclusive: "bg-amber-500/10 border border-amber-500/30 text-amber-300 shadow-inner-light",
        timeout: "bg-amber-500/10 border border-amber-500/30 text-amber-300 shadow-inner-light",
        system_error: "bg-rose-500/10 border border-rose-500/30 text-rose-300 shadow-inner-light",
        unsupported: "bg-slate-500/10 border border-slate-500/30 text-slate-400 shadow-inner-light",
      },
    },
    defaultVariants: {
      variant: "queued",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  showIcon?: boolean;
}

function Badge({ className, variant, showIcon = true, children, ...props }: BadgeProps) {
  const iconMap: Record<string, React.ReactNode> = {
    pass: <Check className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]" />,
    fail: <X className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(244,63,94,0.8)]" />,
    running: <Loader2 className="w-3.5 h-3.5 animate-spin drop-shadow-[0_0_5px_rgba(139,92,246,0.8)]" />,
    queued: <Clock className="w-3.5 h-3.5" />,
    inconclusive: <AlertTriangle className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]" />,
    timeout: <Clock className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]" />,
    system_error: <AlertOctagon className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(244,63,94,0.8)]" />,
    unsupported: <XCircle className="w-3.5 h-3.5 text-slate-400" />,
  };

  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {showIcon && variant && iconMap[variant]}
      {children || variant}
    </div>
  )
}

export { Badge, badgeVariants }

