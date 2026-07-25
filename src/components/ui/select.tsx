import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
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
}

export function Select({ value, onValueChange, options, placeholder = "Select an option", className, id, name }: SelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative w-full h-11 text-sm", className)} ref={containerRef}>
      {name && <input type="hidden" name={name} value={value} id={id} />}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-full w-full items-center justify-between rounded-xl border border-white/20 bg-black/60 px-4 py-2 text-inherit text-white shadow-inner-light backdrop-blur-md transition-all focus:outline-none focus:ring-1 focus:border-transparent focus:ring-violet-400 focus:shadow-glow-primary hover:border-white/30",
          isOpen && "ring-1 border-transparent ring-violet-400 shadow-glow-primary"
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-full rounded-md border border-white/20 bg-[#030712]/95 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.8)] overflow-hidden animate-[fade-in-up_0.15s_ease-out_forwards]">
          <ul
            className="max-h-60 overflow-auto p-1"
            role="listbox"
          >
            {options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={value === option.value}
                onClick={() => {
                  onValueChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none hover:bg-white/10 hover:text-white transition-colors",
                  value === option.value ? "text-indigo-400 font-medium bg-white/5" : "text-slate-300"
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  {value === option.value && <Check className="h-4 w-4 text-indigo-400" />}
                </span>
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
