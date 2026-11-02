import { useDismissibleNotice } from "@openducktor/frontend-core/lib/use-dismissible-notice";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A small icon button that closes a terminal notice or message. */
export function DismissButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}): ReactElement {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("size-6 shrink-0", className)}
      aria-label={label}
      onClick={onClick}
    >
      <X className="size-3" aria-hidden="true" />
    </Button>
  );
}

const TONES = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-warning-surface text-warning-surface-foreground",
  muted: "bg-muted text-muted-foreground",
} as const;

/**
 * A full-width terminal notice with optional actions and a Dismiss button. `error` is a failure,
 * `warning` needs attention, and `muted` informs. Only the message is a live region, so screen
 * readers do not read the button labels with it. The mobile app has the same strip.
 */
export function TerminalNoticeStrip({
  tone,
  role,
  label,
  className,
  children,
  action,
  dismissLabel,
  onDismiss,
}: {
  tone: keyof typeof TONES;
  role: "alert" | "status";
  label?: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
  dismissLabel: string;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 py-1 pr-1.5 pl-3 text-xs",
        TONES[tone],
        className,
      )}
    >
      <p role={role} aria-label={label} className="min-w-0 flex-1 break-words">
        {children}
      </p>
      {action}
      <DismissButton label={dismissLabel} onClick={onDismiss} />
    </div>
  );
}

/**
 * The notices under a terminal: a terminal problem, then the exit status. A nonzero exit code is
 * normal shell behavior, so the exit status informs. The host sends its failure and the exit again
 * on each attach, so a dismissed notice stays hidden while its text stays the same.
 */
export function TerminalViewportNotices({
  attention,
  exitText,
}: {
  attention: string | null;
  exitText: string | null;
}): ReactElement {
  const problem = useDismissibleNotice(attention);
  const exit = useDismissibleNotice(exitText);
  return (
    <>
      {problem.visible === null ? null : (
        <TerminalNoticeStrip
          tone="warning"
          role="alert"
          label="Terminal problem"
          className="border-t border-border"
          dismissLabel="Dismiss terminal problem"
          onDismiss={problem.dismiss}
        >
          {problem.visible}
        </TerminalNoticeStrip>
      )}
      {exit.visible === null ? null : (
        <TerminalNoticeStrip
          tone="muted"
          role="status"
          label="Terminal exit status"
          className="border-t border-border"
          dismissLabel="Dismiss terminal exit status"
          onDismiss={exit.dismiss}
        >
          {exit.visible}
        </TerminalNoticeStrip>
      )}
    </>
  );
}
