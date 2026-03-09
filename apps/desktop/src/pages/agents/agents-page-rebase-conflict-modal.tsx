import { type ReactElement, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { SCENARIO_LABELS } from "./agents-page-constants";
import type {
  PendingRebaseConflictResolutionRequest,
  RebaseConflictResolutionDecision,
} from "./use-agent-studio-rebase-conflict-resolution";

type RebaseConflictResolutionModalProps = {
  request: PendingRebaseConflictResolutionRequest;
  onResolve: (decision: RebaseConflictResolutionDecision) => void;
};

type UseRebaseConflictResolutionModalStateResult = {
  mode: "existing" | "new";
  selectedSessionId: string;
  hasExistingSessions: boolean;
  confirmDisabled: boolean;
  setMode: (mode: "existing" | "new") => void;
  setSelectedSessionId: (sessionId: string) => void;
};

const formatConflictResolutionSessionMeta = (session: AgentSessionState): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  return `${startedAtLabel} · ${session.status} · ${session.sessionId.slice(0, 8)}`;
};

export function useRebaseConflictResolutionModalState(
  request: PendingRebaseConflictResolutionRequest,
): UseRebaseConflictResolutionModalStateResult {
  const [mode, setMode] = useState<"existing" | "new">(request.defaultMode);
  const [selectedSessionId, setSelectedSessionId] = useState(request.defaultSessionId ?? "");
  const hasExistingSessions = request.builderSessions.length > 0;
  const confirmDisabled = mode === "existing" && selectedSessionId.trim().length === 0;

  useEffect(() => {
    setMode(request.defaultMode);
    setSelectedSessionId(request.defaultSessionId ?? "");
  }, [request]);

  return {
    mode,
    selectedSessionId,
    hasExistingSessions,
    confirmDisabled,
    setMode,
    setSelectedSessionId,
  };
}

export function RebaseConflictResolutionModal({
  request,
  onResolve,
}: RebaseConflictResolutionModalProps): ReactElement {
  const {
    mode,
    selectedSessionId,
    hasExistingSessions,
    confirmDisabled,
    setMode,
    setSelectedSessionId,
  } = useRebaseConflictResolutionModalState(request);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onResolve(null);
        }
      }}
    >
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <div className="space-y-6 px-6 py-6 sm:px-7 sm:py-7">
          <DialogHeader className="space-y-3 pr-10">
            <DialogTitle>Resolve rebase conflict with Builder</DialogTitle>
            <DialogDescription className="max-w-[42rem] text-[15px] leading-7">
              Choose an existing Builder session for this task, or start a new conflict-resolution
              Builder session in the current worktree.
            </DialogDescription>
          </DialogHeader>

          {hasExistingSessions ? (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Existing session
              </p>
              <div className="space-y-2">
                {request.builderSessions.map((session) => {
                  const isSelected = mode === "existing" && selectedSessionId === session.sessionId;
                  const isCurrentViewSession = session.sessionId === request.currentViewSessionId;
                  return (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`flex w-full cursor-pointer items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                      onClick={() => {
                        setMode("existing");
                        setSelectedSessionId(session.sessionId);
                      }}
                      data-testid={`agent-studio-rebase-conflict-session-option-${session.sessionId}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {SCENARIO_LABELS[session.scenario] ?? session.scenario}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatConflictResolutionSessionMeta(session)}
                        </p>
                      </div>
                      {isCurrentViewSession ? (
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Current view
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              New session
            </p>
            <button
              type="button"
              className={`flex w-full cursor-pointer items-start justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "new"
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
              onClick={() => setMode("new")}
              data-testid="agent-studio-rebase-conflict-new-session-option"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Start a new Builder session in the current worktree
                </p>
                <p className="text-xs text-muted-foreground">
                  The new session will attach to{" "}
                  <code className="font-mono">{request.currentWorktreePath}</code>.
                </p>
              </div>
            </button>
          </div>
        </div>

        <DialogFooter className="mt-0 flex flex-row items-center justify-between border-t border-border px-6 py-5 sm:px-7">
          <Button type="button" variant="outline" onClick={() => onResolve(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (mode === "existing" && selectedSessionId.trim().length > 0) {
                onResolve({ mode: "existing", sessionId: selectedSessionId });
                return;
              }
              onResolve({ mode: "new" });
            }}
            data-testid="agent-studio-rebase-conflict-confirm-button"
          >
            {mode === "existing" ? "Use selected session" : "Start new session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
