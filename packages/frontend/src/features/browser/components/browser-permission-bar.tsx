import { type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserPromptOf } from "./browser-component-types";
import { BROWSER_PERMISSION_TEXT } from "./browser-permission-text";
import { useBrowserAsyncAction } from "./use-browser-async-action";

export type BrowserPermissionBarProps = {
  prompt: BrowserPromptOf<"permission">;
  /** A rejected promise keeps the bar and shows the error. */
  onAnswer: (allow: boolean) => Promise<void>;
};

/** Asks the user to allow or deny a site permission. The page waits for the answer. */
export function BrowserPermissionBar({
  prompt,
  onAnswer,
}: BrowserPermissionBarProps): ReactElement {
  const text = BROWSER_PERMISSION_TEXT[prompt.permission];
  const Icon = text.icon;
  const answer = useBrowserAsyncAction();
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-info-border/60 bg-info-surface px-3 py-2 text-info-surface-foreground"
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <p id={titleId} className="text-sm">
          <span className="font-medium break-all">{prompt.origin}</span> asks to {text.request}.
        </p>
        <p className="text-xs opacity-80">OpenDucktor saves your choice for this site.</p>
        {answer.error ? (
          <p role="alert" className="text-xs text-destructive">
            {answer.error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={answer.pending}
          onClick={() => void answer.run(() => onAnswer(false))}
        >
          Deny
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={answer.pending}
          onClick={() => void answer.run(() => onAnswer(true))}
        >
          Allow
        </Button>
      </div>
    </section>
  );
}
