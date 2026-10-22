import { Item as RadioGroupPrimitiveItem } from "@radix-ui/react-radio-group";
import { Check, type LucideIcon } from "lucide-react";
import { type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

type WorkspaceSessionWorkLocationFieldProps<Value extends string> = {
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly {
    value: Value;
    label: string;
    description: string;
    icon: LucideIcon;
  }[];
  disabled?: boolean;
  ariaLabel?: string;
};

export function WorkspaceSessionWorkLocationField<Value extends string>({
  value,
  onValueChange,
  options,
  disabled = false,
  ariaLabel = "Work location",
}: WorkspaceSessionWorkLocationFieldProps<Value>): ReactElement {
  const id = useId();

  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Work location</legend>
      <RadioGroup
        aria-label={ariaLabel}
        value={value}
        onValueChange={(nextValue) => {
          const option = options.find((option) => option.value === nextValue);
          if (option) onValueChange(option.value);
        }}
        disabled={disabled}
        className="grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {options.map((option) => {
          const labelId = `${id}-${option.value}-label`;
          const descriptionId = `${id}-${option.value}-description`;
          const selected = value === option.value;

          return (
            <RadioGroupPrimitiveItem
              key={option.value}
              value={option.value}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              asChild
            >
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-auto min-w-0 items-start justify-start gap-3 whitespace-normal p-3 text-left text-foreground dark:border-muted-foreground/60",
                  selected &&
                    "border-primary bg-accent dark:border-selected-accent dark:bg-selected-surface",
                )}
              >
                <option.icon aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span id={labelId}>{option.label}</span>
                  <span
                    id={descriptionId}
                    className="text-xs font-normal text-foreground/70 dark:text-foreground/80"
                  >
                    {option.description}
                  </span>
                </span>
                {selected && <Check aria-hidden="true" />}
              </Button>
            </RadioGroupPrimitiveItem>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
