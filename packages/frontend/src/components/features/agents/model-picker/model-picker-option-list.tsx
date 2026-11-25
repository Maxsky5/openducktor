import { Check } from "lucide-react";
import type { ReactElement, Ref } from "react";
import { cn } from "@/lib/utils";

export type OptionListItem = {
  value: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
  leading?: ReactElement | undefined;
};

export function OptionList({
  ariaLabel,
  items,
  selectedValue,
  onSelect,
  firstSelectableRef,
  maxHeightClassName,
  layout = "stack",
}: {
  ariaLabel: string;
  items: readonly OptionListItem[];
  selectedValue: string | undefined;
  onSelect: (value: string) => void;
  firstSelectableRef?: Ref<HTMLButtonElement> | undefined;
  maxHeightClassName?: string | undefined;
  layout?: "stack" | "grid" | undefined;
}): ReactElement {
  let assignedRef = false;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        layout === "grid" ? "grid grid-cols-1 gap-1.5 @[24rem]:grid-cols-2" : "flex flex-col gap-1",
        maxHeightClassName,
      )}
    >
      {items.map((item) => {
        const selected = item.value === selectedValue;
        const disabled = item.disabled === true;
        const shouldAttachRef = firstSelectableRef && !disabled && !assignedRef;
        if (shouldAttachRef) {
          assignedRef = true;
        }
        return (
          <button
            key={item.value}
            ref={shouldAttachRef ? firstSelectableRef : undefined}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            title={item.description}
            onClick={() => {
              if (!disabled && !selected) {
                onSelect(item.value);
              }
            }}
            className={cn(
              "flex w-full items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-border bg-background text-foreground shadow-2xs"
                : "border-border/50 bg-transparent text-foreground hover:border-border hover:bg-background/70",
              disabled &&
                "cursor-not-allowed opacity-55 hover:border-border/50 hover:bg-transparent",
            )}
          >
            <span className="flex min-w-0 flex-1 items-start gap-2">
              {item.leading ? <span className="mt-0.5 shrink-0">{item.leading}</span> : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{item.label}</span>
                {item.description ? (
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </span>
            {selected ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
