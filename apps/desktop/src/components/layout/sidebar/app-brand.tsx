import { Bot } from "lucide-react";
import type { ReactElement } from "react";

export function AppBrand(): ReactElement {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="rounded-xl bg-slate-900 p-2 text-white shadow-md">
        <Bot className="size-5" />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight">OpenDucktor</p>
        <p className="text-xs text-slate-500">Agent Orchestration</p>
      </div>
    </div>
  );
}
