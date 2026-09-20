import type { KanbanTaskCardView } from "@openducktor/contracts";
import { Rows2, Rows3 } from "lucide-react";
import type { ReactElement } from "react";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type TaskCardViewControlProps = {
  value: KanbanTaskCardView | null;
  disabled?: boolean;
  "aria-labelledby"?: string;
  onValueChange: (value: KanbanTaskCardView) => void;
};

const TASK_CARD_VIEW_OPTIONS = [
  { value: "normal", label: "Normal", icon: Rows2 },
  { value: "compact", label: "Compact", icon: Rows3 },
] as const;

export function TaskCardViewControl({
  value,
  disabled = false,
  "aria-labelledby": ariaLabelledBy,
  onValueChange,
}: TaskCardViewControlProps): ReactElement {
  const isUnavailable = disabled || value === null;

  return (
    <TooltipProvider>
      <RadioGroup
        aria-label={ariaLabelledBy ? undefined : "Task card view"}
        aria-labelledby={ariaLabelledBy}
        aria-disabled={isUnavailable}
        value={value ?? ""}
        data-variant="segmented"
        className="flex h-10 w-auto items-center gap-1 rounded-lg bg-muted p-1"
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
          const Icon = option.icon;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <RadioGroupSegmentItem
                    value={option.value}
                    aria-label={option.label}
                    aria-disabled={isUnavailable}
                    className="size-8 flex-none p-0 text-foreground/70 [&_svg]:size-4"
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
