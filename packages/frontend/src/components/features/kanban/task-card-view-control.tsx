import type { KanbanTaskCardView } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TASK_CARD_VIEW_OPTIONS } from "@openducktor/frontend-core/tasks/board/task-card-view-options";
import { TASK_CARD_VIEW_ICONS } from "./task-card-view-options";

type TaskCardViewControlProps = {
  value: KanbanTaskCardView | null;
  disabled?: boolean;
  /** `md` fits a form row. `sm` fits a page header toolbar. */
  size?: "sm" | "md";
  "aria-labelledby"?: string;
  onValueChange: (value: KanbanTaskCardView) => void;
};

export function TaskCardViewControl({
  value,
  disabled = false,
  size = "md",
  "aria-labelledby": ariaLabelledBy,
  onValueChange,
}: TaskCardViewControlProps): ReactElement {
  const isUnavailable = disabled || value === null;
  const classes = SIZE_CLASSES[size];

  return (
    <TooltipProvider>
      <RadioGroup
        aria-label={ariaLabelledBy ? undefined : "Task card view"}
        aria-labelledby={ariaLabelledBy}
        aria-disabled={isUnavailable}
        value={value ?? ""}
        data-variant="segmented"
        className={cn("flex w-auto items-center gap-1 rounded-lg bg-muted p-1", classes.group)}
        onValueChange={(nextValue) => {
          if (isUnavailable) {
            return;
          }
          const option = TASK_CARD_VIEW_OPTIONS.find((candidate) => candidate.value === nextValue);
          if (option && option.value !== value) {
            onValueChange(option.value);
          }
        }}
      >
        {TASK_CARD_VIEW_OPTIONS.map((option) => {
          const Icon = TASK_CARD_VIEW_ICONS[option.value];
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <RadioGroupSegmentItem
                    value={option.value}
                    aria-label={option.label}
                    aria-disabled={isUnavailable}
                    className={cn("flex-none p-0 text-foreground/70", classes.item)}
                  >
                    <Icon aria-hidden="true" />
                  </RadioGroupSegmentItem>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{option.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </RadioGroup>
    </TooltipProvider>
  );
}

const SIZE_CLASSES = {
  sm: { group: "h-8", item: "size-6 [&_svg]:size-3.5" },
  md: { group: "h-10", item: "size-8 [&_svg]:size-4" },
} as const;
