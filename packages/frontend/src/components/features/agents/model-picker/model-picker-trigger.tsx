import type { ShortcutActionId } from "@openducktor/contracts";
import type { ModelTriggerSummary } from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import { ChevronsUpDown, Zap } from "lucide-react";
import type { ComponentProps, ReactElement, Ref } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import type { Button } from "@/components/ui/button";
import { ShortcutButton } from "@/features/shortcuts/shortcut-controls";
import { cn } from "@/lib/utils";
import "./step-track-slider.css";

export type ModelPickerTriggerProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "children" | "ref"
> & {
  ref?: Ref<HTMLButtonElement> | undefined;
  summary: ModelTriggerSummary;
  triggerVariant: "composer" | "form";
  shortcutId: ShortcutActionId | undefined;
  disabledReason: string | null;
  disabledReasonId: string;
  isDisabled: boolean;
};

export function ModelPickerTrigger({
  ref,
  summary,
  triggerVariant,
  shortcutId,
  className,
  disabledReason,
  disabledReasonId,
  isDisabled,
  onClick,
  ...buttonProps
}: ModelPickerTriggerProps): ReactElement {
  const isComposer = triggerVariant === "composer";
  const showSpeed = summary.speedTone !== "standard";

  return (
    <ShortcutButton
      {...buttonProps}
      shortcutId={shortcutId}
      ref={ref}
      type="button"
      variant={isComposer ? "ghost" : "outline"}
      title={disabledReason ?? (shortcutId ? "Choose model" : "")}
      aria-label={summary.ariaLabel}
      aria-disabled={isDisabled}
      aria-describedby={disabledReason ? disabledReasonId : undefined}
      onClick={isDisabled ? (event) => event.preventDefault() : onClick}
      className={cn(
        isComposer
          ? "h-8 max-w-full min-w-0 justify-between gap-1.5 rounded-lg border border-transparent bg-transparent px-2 text-xs font-normal text-foreground hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring"
          : "h-9 w-full min-w-0 justify-between gap-2 border-input bg-card px-3 font-normal focus-visible:ring-0 focus-visible:border-ring",
        isDisabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {summary.runtime ? (
          <span className="shrink-0">
            <AgentRuntimeIcon runtimeKind={summary.runtime.kind} />
          </span>
        ) : null}
        {summary.profileLabel ? (
          <>
            <span
              data-slot="trigger-profile"
              className="min-w-0 shrink truncate text-foreground/75"
            >
              {summary.profileLabel}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/70">
              /
            </span>
          </>
        ) : null}
        <span data-slot="trigger-model" className="min-w-0 shrink-[1000] truncate">
          {summary.modelLabel}
        </span>
        {summary.effortLabel ? (
          <span
            data-slot="trigger-effort"
            className="shrink-0 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-medium leading-none text-secondary-foreground"
          >
            {summary.effortLabel}
          </span>
        ) : null}
        {showSpeed ? (
          <span
            data-slot="trigger-speed"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium"
          >
            <Zap
              aria-hidden="true"
              data-speed-tone={summary.speedTone}
              className="model-speed-icon size-3.5 shrink-0"
            />
            {!isComposer && summary.nonStandardSpeedLabel ? (
              <span
                data-speed-tone={summary.speedTone}
                className="model-speed-icon whitespace-nowrap"
              >
                {summary.nonStandardSpeedLabel}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </ShortcutButton>
  );
}
