import type { KanbanTaskCardView } from "@openducktor/contracts";
import { Rows2, Rows3 } from "lucide-react";
import type { ReactElement } from "react";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type TaskCardViewControlProps = {
  value: KanbanTaskCardView | null;
  disabled?: boolean;
  onValueChange: (value: KanbanTaskCardView) => void;
};

const TASK_CARD_VIEW_OPTIONS = [
  { value: "normal", label: "Normal", icon: Rows3 },
  { value: "compact", label: "Compact", icon: Rows2 },
] as const;

export function TaskCardViewControl({
  value,
  disabled = false,
  onValueChange,
}: TaskCardViewControlProps): ReactElement {
  return (
    <TooltipProvider>
      <RadioGroup
        aria-label="Task card view"
        value={value ?? ""}
        disabled={disabled || value === null}
        data-variant="segmented"
        className="flex h-10 w-auto items-center gap-1 rounded-lg bg-muted p-1"
        onValueChange={(nextValue) => {
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
