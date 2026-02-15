import { Activity } from "lucide-react";
import type { ReactElement } from "react";

type WorkspaceSnapshotCardProps = {
  taskCount: number;
  runCount: number;
};

export function WorkspaceSnapshotCard({
  taskCount,
  runCount,
}: WorkspaceSnapshotCardProps): ReactElement {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center gap-2 text-slate-600">
        <Activity className="size-3 text-emerald-600" />
        <span>Snapshot</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-slate-700">
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
          Tasks: {taskCount}
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
          Runs: {runCount}
        </div>
      </div>
    </div>
  );
}
