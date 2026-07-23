import * as React from "react"
import { Label } from "./label"
import { Input } from "./input"

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  description?: string;
}

const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ className, label, error, description, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className={`space-y-2 ${className || ""}`}>
        <Label htmlFor={inputId} className={error ? "text-fail" : ""}>
          {label}
        </Label>
        <Input
          id={inputId}
          ref={ref}
          error={!!error}
          {...props}
        />
        {description && !error && (
          <p className="text-[0.8rem] text-slate-500">{description}</p>
        )}
        {error && (
          <p className="text-[0.8rem] font-medium text-fail">{error}</p>
        )}
      </div>
    )
  }
)
FormField.displayName = "FormField"

export { FormField }
