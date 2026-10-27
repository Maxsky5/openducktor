import type { TaskApprovalTextWithCode } from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export const SECTION_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground";

/** The scrolling body of a stage. The modal has a fixed height, so a long stage scrolls. */
export const STAGE_BODY_CLASS = "min-h-0 flex-1 overflow-y-auto";

/** The content of a stage, inside its body. */
export const STAGE_CONTENT_CLASS = "space-y-6 px-6 py-6 sm:px-8";

/** The footer of a stage. On small screens, the confirm actions stack above Cancel. */
export const STAGE_ACTIONS_FOOTER_CLASS =
  "mt-0 flex-col-reverse gap-3 border-t border-border/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8";

export function SegmentedTabs<TValue extends string>({
  ariaLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  value: TValue;
  options: ReadonlyArray<{
    value: TValue;
    label: string;
    disabled?: boolean;
  }>;
  disabled?: boolean;
  onChange: (value: TValue) => void;
}): ReactElement {
  return (
    <SegmentedControlRoot size="lg" className="w-full" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <SegmentedControlItem
            key={option.value}
            active={isActive}
            size="lg"
            role="tab"
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControlRoot>
  );
}

export function OptionCard<TValue extends string>({
  value,
  selectedValue,
  label,
  description,
  disabled,
  onSelect,
}: {
  value: TValue;
  selectedValue: TValue;
  label: string;
  description: string;
  disabled?: boolean;
  onSelect: (value: TValue) => void;
}): ReactElement {
  const isSelected = value === selectedValue;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        "group grid cursor-pointer content-start gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-info-border bg-info-surface shadow-sm"
          : "border-border bg-card text-foreground hover:border-input hover:bg-muted/60",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-base font-semibold text-foreground">{label}</span>
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            isSelected
              ? "border-info-border bg-info-surface text-info-muted"
              : "border-input bg-card text-transparent",
          )}
        >
          <Check className="size-3.5" />
        </span>
      </div>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

/** A sentence of the approval text with its branch or path in the code font. */
export function TextWithCode({ text }: { text: TaskApprovalTextWithCode }): ReactElement {
  return (
    <>
      {text.before}
      <span className="font-mono text-[13px] text-foreground">{text.code}</span>
      {text.after}
    </>
  );
}
