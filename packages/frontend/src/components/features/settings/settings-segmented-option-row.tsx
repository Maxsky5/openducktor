import type { ReactElement } from "react";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";

export type SettingsSegmentedOption<Value extends string> = {
  value: Value;
  label: string;
};

type SettingsSegmentedOptionRowProps<Value extends string> = {
  title: string;
  description: string;
  value: Value;
  options: readonly SettingsSegmentedOption<Value>[];
  disabled: boolean;
  onValueChange: (value: Value) => void;
};

export function SettingsSegmentedOptionRow<Value extends string>({
  title,
  description,
  value,
  options,
  disabled,
  onValueChange,
}: SettingsSegmentedOptionRowProps<Value>): ReactElement {
  return (
    <div className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,auto)] sm:items-center">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <SegmentedControlRoot
        size="sm"
        aria-label={title}
        className="grid h-auto w-full grid-cols-2 items-stretch rounded-lg sm:inline-flex sm:h-9 sm:w-auto"
      >
        {options.map((option) => (
          <SegmentedControlItem
            key={option.value}
            active={value === option.value}
            size="sm"
            disabled={disabled}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControlRoot>
    </div>
  );
}
