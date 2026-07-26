import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-slate-50",
  {
    variants: {
      variant: {
        default: "bg-slate-900 text-slate-50 border-slate-800",
        destructive:
          "border-fail/50 text-fail dark:border-fail [&>svg]:text-fail bg-fail/10",
        success:
          "border-pass/50 text-pass dark:border-pass [&>svg]:text-pass bg-pass/10",
        inconclusive:
          "border-inconclusive/50 text-inconclusive dark:border-inconclusive [&>svg]:text-inconclusive bg-inconclusive/10",
        timeout:
          "border-timeout/50 text-timeout dark:border-timeout [&>svg]:text-timeout bg-timeout/10",
        system_error:
          "border-system_error/50 text-rose-300 dark:border-system_error [&>svg]:text-rose-300 bg-system_error/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed opacity-90", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
