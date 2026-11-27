import type { BackgroundOperationStep } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  backgroundOperationStatus,
  backgroundStepStatus,
  canFinishClosingTask,
} from "@openducktor/frontend-core/operations/background-operation-presentation";
import {
  backgroundAttemptOrigin,
  type BackgroundAttempt,
  type BackgroundOperationStore,
} from "@openducktor/frontend-core/operations/background-operation-store";
import { useBackgroundAttempts } from "@openducktor/frontend-core/operations/use-background-attempts";
import { Check, LoaderCircle, OctagonAlert, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasMountedModalDialog,
  returnFocusOnClose,
  subscribeDialogFocusReleased,
  subscribeOpenDialogs,
} from "@/components/ui/open-dialogs";
import { ToastResizeContent } from "@/components/ui/toast-resize";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { notificationClassNames } from "@/lib/sonner-feedback";

export type FinishClosingTask = (workspaceId: string, taskId: string) => void;

export function BackgroundOperationNotifications({
  finishClosingTask,
}: {
  finishClosingTask?: FinishClosingTask | undefined;
}) {
  const attempts = useBackgroundAttempts();
  return (
    <>
      {attempts
        .filter((attempt) => !attempt.toastDismissed)
        .map((attempt) => (
          <BackgroundToast key={attempt.id} attempt={attempt} />
        ))}
      <BackgroundResults
        finishClosingTask={finishClosingTask}
        next={attempts.find((attempt) => attempt.phase === "failed" && !attempt.failureDismissed)}
      />
    </>
  );
}

function BackgroundToast({ attempt }: { attempt: BackgroundAttempt }) {
  const { backgroundOperations } = useClientConnection();
  const [contentHeight, setContentHeight] = useState(0);
  const id = `background-operation:${attempt.id}`;
  useEffect(
    () => () => {
      toast.dismiss(id);
    },
    [id],
  );
  useEffect(() => {
    const pending = attempt.phase === "running";
    toast(`${attempt.action} · ${backgroundOperationStatus[attempt.phase]}`, {
      id,
      duration: Infinity,
      dismissible: !pending,
      closeButton: !pending,
      classNames: notificationClassNames,
      icon: <OperationIcon phase={attempt.phase} />,
      description: (
        <ToastResizeContent onResize={setContentHeight} className="flex min-w-0 flex-col gap-1.5">
          <p className="break-words">{backgroundAttemptOrigin(attempt)}</p>
          {attempt.progress?.steps.length ? (
            <div className="max-h-40 overflow-y-auto">
              <OperationSteps steps={attempt.progress.steps} compact />
            </div>
          ) : pending ? (
            <p>Waiting for the host…</p>
          ) : null}
          {attempt.phase === "unconfirmed" ? (
            <p className="text-warning-surface-foreground">{attempt.message}</p>
          ) : null}
          {attempt.phase !== "running" && attempt.phase !== "failed" ? (
            <CopyDrafts attempt={attempt} getArchiveDraft={backgroundOperations.getArchiveDraft} />
          ) : null}
        </ToastResizeContent>
      ),
      onDismiss: () => backgroundOperations.dismissToast(attempt.id),
    });
  }, [attempt, backgroundOperations, contentHeight, id]);
  return null;
}

function OperationIcon({ phase }: Pick<BackgroundAttempt, "phase">) {
  switch (phase) {
    case "running":
      return (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 text-info-surface-foreground motion-safe:animate-spin"
        />
      );
    case "succeeded":
      return <Check aria-hidden="true" className="size-4 text-success-icon" />;
    case "failed":
      return <OctagonAlert aria-hidden="true" className="size-4 text-destructive" />;
    case "unconfirmed":
      return (
        <TriangleAlert aria-hidden="true" className="size-4 text-warning-surface-foreground" />
      );
  }
}

function OperationSteps({
  steps,
  compact,
}: {
  steps: BackgroundOperationStep[];
  compact?: boolean;
}) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.id} className="min-w-0 break-words">
          <span className="font-medium">{step.label}</span>
          <span className="text-muted-foreground"> · {backgroundStepStatus[step.state]}</span>
          {!compact ? (
            <>
              {step.details.map((detail) => (
                <p key={detail}>{detail}</p>
              ))}
              {step.resources?.map((resource) => (
                <p key={`${resource.kind}:${resource.value}`} className="text-muted-foreground">
                  {resource.state === "removed" ? "Removed " : ""}
                  {resource.value}
                </p>
              ))}
              {step.failure ? <p className="text-destructive">{step.failure.message}</p> : null}
            </>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function BackgroundResults({
  next,
  finishClosingTask,
}: {
  next: BackgroundAttempt | undefined;
  finishClosingTask?: FinishClosingTask | undefined;
}) {
  const { backgroundOperations } = useClientConnection();
  const returnTarget = useRef<HTMLElement | null>(null);
  const [showing, setShowing] = useState<BackgroundAttempt>();
  const [closing, setClosing] = useState(false);
  const finishClose = useRef(false);
  useEffect(() => {
    if (!next || showing) return;
    const check = () => {
      if (hasMountedModalDialog()) return;
      returnTarget.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShowing(next);
    };
    const offFocus = subscribeDialogFocusReleased(check);
    const offOpen = subscribeOpenDialogs(() => queueMicrotask(check));
    queueMicrotask(check);
    return () => {
      offFocus();
      offOpen();
    };
  }, [next, showing]);

  if (!showing) return null;
  const { id, target, workspace, progress } = showing;
  const steps = progress?.steps ?? [];
  const canFinish = finishClosingTask && target.kind === "task" && canFinishClosingTask(showing);
  return (
    <Dialog
      open={!closing}
      onOpenChange={(open) => {
        if (!open) setClosing(true);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          returnFocusOnClose(() => returnTarget.current)(event);
          backgroundOperations.dismissFailure(id);
          setShowing(undefined);
          setClosing(false);
          if (finishClose.current && target.kind === "task")
            finishClosingTask?.(workspace.workspaceId, target.taskId);
          finishClose.current = false;
        }}
      >
        <DialogHeader>
          <DialogTitle>{showing.action} failed</DialogTitle>
          <DialogDescription>{backgroundAttemptOrigin(showing)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {steps.length ? <OperationSteps steps={steps} /> : null}
          {showing.message && !steps.some((step) => step.failure?.message === showing.message) ? (
            <p className="break-words text-destructive">{showing.message}</p>
          ) : null}
          {progress?.phase === "failed" ? <p>{progress.failure.nextAction}</p> : null}
          <CopyDrafts attempt={showing} getArchiveDraft={backgroundOperations.getArchiveDraft} />
        </div>
        <DialogFooter>
          {canFinish ? (
            <Button
              variant="outline"
              onClick={() => {
                finishClose.current = true;
                setClosing(true);
              }}
            >
              Finish closing task
            </Button>
          ) : null}
          <Button onClick={() => setClosing(true)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyDrafts({
  attempt,
  getArchiveDraft,
}: {
  attempt: BackgroundAttempt;
  getArchiveDraft: BackgroundOperationStore["getArchiveDraft"];
}) {
  const { copyToClipboard } = useCopyToClipboard({
    successMessage: "Draft copied",
    copyFailedMessage: "Could not copy the draft",
  });
  const { workspace, target, archiveDraftFileIds } = attempt;
  if (target.kind !== "chat" || !archiveDraftFileIds) return null;
  return archiveDraftFileIds.map((fileId) => {
    const read = () => getArchiveDraft(workspace.workspaceId, target.sessionId, fileId);
    const draft = read();
    if (!draft) return null;
    return (
      <Button
        key={fileId}
        variant="outline"
        size="sm"
        className="max-w-full"
        onClick={() => {
          const current = read();
          if (current) void copyToClipboard(current.contents);
          else toast.info("This chat has no retained draft for this file");
        }}
      >
        <span className="truncate">
          Copy retained draft
          {archiveDraftFileIds.length > 1 ? ` for ${draft.baseline.relativePath}` : ""}
        </span>
      </Button>
    );
  });
}
