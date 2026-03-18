import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SCENARIO_LABELS } from "@/features/session-start";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  GitConflictResolutionDecision,
  PendingGitConflictResolutionRequest,
} from "./use-git-conflict-resolution";

type GitConflictResolutionModalProps = {
  request: PendingGitConflictResolutionRequest;
  onResolve: (decision: GitConflictResolutionDecision) => void;
};

type UseGitConflictResolutionModalStateResult = {
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

type GitConflictResolutionModalState = {
  requestKey: string;
  mode: "existing" | "new";
  selectedSessionId: string;
};

const getRequestKey = (request: PendingGitConflictResolutionRequest): string =>
  `${request.requestId}:${request.defaultMode}:${request.defaultSessionId ?? ""}`;

const createModalState = (
  request: PendingGitConflictResolutionRequest,
): GitConflictResolutionModalState => ({
  requestKey: getRequestKey(request),
  mode: request.defaultMode,
  selectedSessionId: request.defaultSessionId ?? "",
});

const reconcileModalState = (
  previousState: GitConflictResolutionModalState,
  requestKey: string,
  request: PendingGitConflictResolutionRequest,
): GitConflictResolutionModalState =>
  previousState.requestKey === requestKey ? previousState : createModalState(request);

export function useGitConflictResolutionModalState(
  request: PendingGitConflictResolutionRequest,
): UseGitConflictResolutionModalStateResult {
  const requestKey = getRequestKey(request);
  const [state, setState] = useState<GitConflictResolutionModalState>(() =>
    createModalState(request),
  );
  const currentState = reconcileModalState(state, requestKey, request);
  const hasExistingSessions = request.builderSessions.length > 0;
  const trimmedSelectedSessionId = currentState.selectedSessionId.trim();
  const canConfirmExistingSession =
    currentState.mode === "existing" &&
    trimmedSelectedSessionId.length > 0 &&
    request.builderSessions.some((session) => session.sessionId === trimmedSelectedSessionId);
  const confirmDisabled = currentState.mode === "existing" && !canConfirmExistingSession;

  return {
    mode: currentState.mode,
    selectedSessionId: currentState.selectedSessionId,
    hasExistingSessions,
    confirmDisabled,
    setMode: (mode) => {
      setState((previousState) => {
        const baseState = reconcileModalState(previousState, requestKey, request);
        return { ...baseState, mode };
      });
    },
    setSelectedSessionId: (selectedSessionId) => {
      setState((previousState) => {
        const baseState = reconcileModalState(previousState, requestKey, request);
        return { ...baseState, selectedSessionId };
      });
    },
  };
}

export function GitConflictResolutionModal({
  request,
  onResolve,
}: GitConflictResolutionModalProps): ReactElement {
  const {
    mode,
    selectedSessionId,
    hasExistingSessions,
    confirmDisabled,
    setMode,
    setSelectedSessionId,
  } = useGitConflictResolutionModalState(request);
  const trimmedSelectedSessionId = selectedSessionId.trim();
  const canConfirmExistingSession =
    mode === "existing" &&
    trimmedSelectedSessionId.length > 0 &&
    request.builderSessions.some((session) => session.sessionId === trimmedSelectedSessionId);

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
            <DialogTitle>Resolve git conflict with Builder</DialogTitle>
            <DialogDescription className="max-w-[42rem] text-[15px] leading-7">
              Choose an existing Builder session in the same worktree, or start a new
              conflict-resolution Builder session attached to the paused worktree.
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
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Start a new Builder session in the paused worktree
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
              if (mode === "existing") {
                if (!canConfirmExistingSession) {
                  return;
                }
                onResolve({ mode: "existing", sessionId: trimmedSelectedSessionId });
                return;
              }
              onResolve({ mode: "new" });
            }}
          >
            {mode === "existing" ? "Use selected session" : "Start new session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
