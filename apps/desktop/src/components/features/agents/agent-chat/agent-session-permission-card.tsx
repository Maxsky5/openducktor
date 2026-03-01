import { CircleSlash2, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";

type PermissionReply = "once" | "always" | "reject";

type AgentSessionPermissionCardProps = {
  request: AgentPermissionRequest;
  disabled?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | undefined;
  onReply: (requestId: string, reply: PermissionReply) => Promise<void>;
};

export function AgentSessionPermissionCard({
  request,
  disabled = false,
  isSubmitting = false,
  errorMessage,
  onReply,
}: AgentSessionPermissionCardProps): ReactElement | null {
  if (request.patterns.length === 0 && !request.permission) {
    return null;
  }

  const patternsText =
    request.patterns.length > 0 ? request.patterns.join(", ") : "No pattern constraints";

  return (
    <section className="rounded-xl border border-warning-border bg-warning-surface shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-warning-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning-muted" />
          <p className="text-[13px] font-semibold text-foreground">Permission request</p>
        </div>
        <p className="text-[11px] font-medium text-muted-foreground">Action required</p>
      </header>

      <div className="space-y-2 p-2.5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{request.permission}</p>
          <p className="text-xs text-foreground">Paths: {patternsText}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={disabled || isSubmitting}
            onClick={() => {
              void onReply(request.requestId, "once");
            }}
          >
            Allow Once
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || isSubmitting}
            onClick={() => {
              void onReply(request.requestId, "always");
            }}
          >
            Always Allow
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={disabled || isSubmitting}
            onClick={() => {
              void onReply(request.requestId, "reject");
            }}
          >
            Reject
          </Button>
        </div>

        {errorMessage ? (
          <p className="rounded-md border border-destructive-border bg-destructive-surface px-2 py-1 text-xs text-destructive-muted">
            {errorMessage}
          </p>
        ) : null}

        {isSubmitting ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleSlash2 className="size-3" />
            Submitting permission choice...
          </p>
        ) : null}
      </div>
    </section>
  );
}
