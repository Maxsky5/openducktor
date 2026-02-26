import { Activity, ArrowUpRight, CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type AgentActivityCardProps = {
  activeSessionCount: number;
  waitingForInputCount: number;
};

export function AgentActivityCard({
  activeSessionCount,
  waitingForInputCount,
}: AgentActivityCardProps): ReactElement {
  const hasWaitingInput = waitingForInputCount > 0;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="flex items-center gap-2 text-slate-700">
        <Activity className="size-3.5 text-sky-600" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Agent Activity</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
          <div className="flex items-center gap-2 text-slate-600">
            <Activity className="size-3.5 text-sky-600" />
            <span>Active sessions</span>
          </div>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">
            {activeSessionCount}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2">
          <div className="flex items-center gap-2 text-slate-600">
            <CircleAlert
              className={hasWaitingInput ? "size-3.5 text-amber-600" : "size-3.5 text-slate-400"}
            />
            <span>Needs your input</span>
          </div>
          <span
            className={
              hasWaitingInput
                ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700"
                : "rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600"
            }
          >
            {waitingForInputCount}
          </span>
        </div>
      </div>

      {hasWaitingInput ? (
        <Button
          asChild
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-between"
        >
          <Link to="/agents">
            Open Agents
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      ) : (
        <p className="text-[11px] text-slate-500">No sessions are waiting on user input.</p>
      )}
    </div>
  );
}
