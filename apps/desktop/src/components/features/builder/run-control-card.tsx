import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RunSummary } from "@openblueprint/contracts";
import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";

type RunControlCardProps = {
  run: RunSummary;
  message: string;
  onMessageChange: (runId: string, value: string) => void;
  onApprove: (runId: string) => void;
  onDeny: (runId: string) => void;
  onStop: (runId: string) => void;
  onCleanupSuccess: (runId: string) => void;
  onCleanupFailure: (runId: string) => void;
  onSendMessage: (runId: string, message: string) => void;
};

export function RunControlCard({
  run,
  message,
  onMessageChange,
  onApprove,
  onDeny,
  onStop,
  onCleanupSuccess,
  onCleanupFailure,
  onSendMessage,
}: RunControlCardProps): ReactElement {
  return (
    <article className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-slate-900 px-2 py-1 text-xs text-white">{run.runId}</code>
        <Badge variant={run.state === "blocked" ? "danger" : "warning"}>{run.state}</Badge>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          <GitBranch className="size-3" />
          {run.branch}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => onApprove(run.runId)}>
          Approve
        </Button>
        <Button type="button" size="sm" variant="destructive" onClick={() => onDeny(run.runId)}>
          Deny
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onStop(run.runId)}>
          Stop
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onCleanupSuccess(run.runId)}
        >
          Cleanup Success
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onCleanupFailure(run.runId)}
        >
          Cleanup Failure
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Reply to agent"
          value={message}
          onChange={(event) => onMessageChange(run.runId, event.currentTarget.value)}
        />
        <Button type="button" variant="secondary" onClick={() => onSendMessage(run.runId, message)}>
          Send
        </Button>
      </div>
    </article>
  );
}
