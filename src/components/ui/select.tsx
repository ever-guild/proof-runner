import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
}

export function Select({ value, onValueChange, options, placeholder = "Select an option", className, id, name, ariaLabel }: SelectProps) {
  return (
    <div className={cn("relative h-11 w-full text-sm", className)}>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "h-full w-full appearance-none rounded-xl border border-white/20 bg-black/60 px-4 py-2 pr-10 text-inherit text-white shadow-inner-light backdrop-blur-md transition-all focus:border-transparent focus:outline-none focus:ring-1 focus:ring-violet-400 focus:shadow-glow-primary hover:border-white/30",
          !value && "text-slate-400",
        )}
      >
        {!value && <option value="" disabled>{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
    </div>
  );
}
