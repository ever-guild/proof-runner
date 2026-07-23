import * as React from "react"
import { cn } from "../../lib/utils"

export interface TerminalProps extends React.HTMLAttributes<HTMLDivElement> {
  logs: string[];
}

const Terminal = React.forwardRef<HTMLDivElement, TerminalProps>(
  ({ className, logs, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "w-full rounded-xl bg-black/60 border border-white/10 p-5 font-mono text-sm overflow-auto shadow-inner-light backdrop-blur-xl",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-fail/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
            <div className="w-3 h-3 rounded-full bg-pass/80 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
          <span className="text-[10px] text-slate-500 ml-4 tracking-widest uppercase font-sans font-semibold">Console Output</span>
        </div>
        <div className="space-y-1.5">
          {logs.map((log, index) => {
            let colorClass = "text-slate-300";
            if (log.includes("ERR!") || log.includes("Error") || log.includes("FAIL")) {
              colorClass = "text-fail drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]";
            } else if (log.includes("PASS") || log.includes("success")) {
              colorClass = "text-pass drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]";
            } else if (log.includes(">") || log.startsWith("$")) {
              colorClass = "text-running drop-shadow-[0_0_5px_rgba(139,92,246,0.5)]";
            }

            return (
              <div key={index} className={colorClass}>
                {log}
              </div>
            );
          })}
          <div className="text-slate-500 animate-pulse">_</div>
        </div>
      </div>
    )
  }
)
Terminal.displayName = "Terminal"

export { Terminal }
