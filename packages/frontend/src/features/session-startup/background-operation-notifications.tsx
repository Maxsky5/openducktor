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
import {
  Check,
  Circle,
  CircleDashed,
  LoaderCircle,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
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
import { TraceIcon } from "@/components/ui/trace";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { notificationClassNames } from "@/lib/sonner-feedback";
import { cn } from "@/lib/utils";
import { STARTUP_TEXT_INSET } from "./constants";
import { StartupStepCounter } from "./startup-card-parts";
import "./background-operation-notifications.css";

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
    const steps = attempt.progress?.steps ?? [];
    const title = `${attempt.action} · ${backgroundOperationStatus[attempt.phase]}`;
    toast(
      <div className="flex min-w-0 items-center gap-2">
        <TraceIcon className="size-5">
          <OperationIcon phase={attempt.phase} />
        </TraceIcon>
        <span className="min-w-0 flex-1 break-words">{title}</span>
        {pending && steps.length > 0 ? (
          <StartupStepCounter
            className="shrink-0"
            completed={steps.filter((step) => step.state === "completed").length}
            total={steps.length}
          />
        ) : null}
      </div>,
      {
        id,
        duration: Infinity,
        dismissible: !pending,
        closeButton: !pending,
        className: "background-operation-toast",
        classNames: notificationClassNames,
        icon: null,
        description: (
          <ToastResizeContent onResize={setContentHeight} className="flex min-w-0 flex-col gap-2">
            <div className={cn("flex min-w-0 flex-col gap-1", STARTUP_TEXT_INSET)}>
              <p className="break-words">{backgroundAttemptOrigin(attempt)}</p>
              {pending && steps.length === 0 ? <p>Waiting for the host…</p> : null}
              {attempt.progress?.phase === "succeeded" && steps.length === 0 ? (
                <p>No changes needed.</p>
              ) : null}
              {attempt.phase === "unconfirmed" ? (
                <p className="text-warning-surface-foreground">{attempt.message}</p>
              ) : null}
            </div>
            {steps.length > 0 ? (
              <div
                className="max-h-[clamp(3rem,calc(100dvh-10rem),13rem)] overflow-y-auto overscroll-contain rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={0}
                role="region"
                aria-label="Operation steps"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <OperationSteps steps={steps} compact />
              </div>
            ) : null}
            {!pending ? (
              <CopyDrafts
                attempt={attempt}
                getArchiveDraft={backgroundOperations.getArchiveDraft}
              />
            ) : null}
          </ToastResizeContent>
        ),
        onDismiss: () => backgroundOperations.dismissToast(attempt.id),
      },
    );
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

const stepIcons = {
  pending: { Icon: Circle, color: "text-muted-foreground" },
  waiting: { Icon: CircleDashed, color: "text-warning-surface-foreground" },
  running: {
    Icon: LoaderCircle,
    color: "bg-info-surface text-info-surface-foreground motion-safe:[&_svg]:animate-spin",
  },
  completed: { Icon: Check, color: "bg-success-surface text-success-icon" },
  failed: {
    Icon: OctagonAlert,
    color: "bg-destructive-surface text-destructive-surface-foreground",
  },
  not_run: { Icon: Minus, color: "text-muted-foreground" },
} satisfies Record<BackgroundOperationStep["state"], { Icon: typeof Circle; color: string }>;

function OperationSteps({
  steps,
  compact,
}: {
  steps: BackgroundOperationStep[];
  compact?: boolean;
}) {
  return (
    <ol className="space-y-2">
      {steps.map((step) => {
        const { Icon, color } = stepIcons[step.state];
        return (
          <li key={step.id} className="min-w-0 break-words">
            <div className="flex min-w-0 items-start gap-2">
              <TraceIcon className={cn("size-5 rounded-full", color)}>
                <Icon className="size-3.5" />
              </TraceIcon>
              <span
                className={cn(
                  "min-w-0 flex-1 font-medium",
                  step.state === "pending" || step.state === "not_run"
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {step.label}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {backgroundStepStatus[step.state]}
              </span>
            </div>
            {!compact ? (
              <div className={STARTUP_TEXT_INSET}>
                {step.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
                {step.resources?.map((resource) => (
                  <p key={`${resource.kind}:${resource.value}`} className="text-muted-foreground">
                    {resource.state === "removed" ? "Removed " : ""}
                    {resource.value}
                  </p>
                ))}
                {step.failure ? (
                  <p className="text-destructive-surface-foreground">{step.failure.message}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
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
        overlayClassName="z-[76]"
        positionerClassName="z-[76]"
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
            <p className="break-words text-destructive-surface-foreground">{showing.message}</p>
          ) : null}
          {progress?.phase === "failed" ? <p>{progress.failure.nextAction}</p> : null}
          <CopyDrafts attempt={showing} getArchiveDraft={backgroundOperations.getArchiveDraft} />
        </div>
        <DialogFooter className={canFinish ? undefined : "justify-end"}>
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
