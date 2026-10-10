import type { AgentSpeedLevel } from "@openducktor/contracts";
import { Zap, ZapOff } from "lucide-react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STANDARD_SPEED } from "@/lib/model-catalog-selection";
import { cn } from "@/lib/utils";
import "./speed-select.css";

export type SpeedControlModel = {
  key: string;
  /** The selected level ID, or `standard`. */
  choice: string;
  /** The levels above standard that the selected model supports. */
  levels: AgentSpeedLevel[];
  blockedReason: string | undefined;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  onChange: (choice: string) => void;
};

export function SpeedSelect({
  model,
  className,
  triggerClassName,
  compact = false,
  label,
}: {
  model: SpeedControlModel | undefined;
  className?: string;
  triggerClassName?: string;
  compact?: boolean;
  label?: string;
}) {
  const labelId = useId();
  const control = useSpeedError(model?.error);
  const [menuOpen, setMenuOpen] = useState(false);
  if (!model || (model.levels.length === 0 && model.choice === STANDARD_SPEED)) return null;
  const { choice, pending } = model;
  const disabled = model.disabled || pending;
  const reason = model.error ?? model.blockedReason;
  const options = speedOptions(model);
  const choiceLabel = speedLabel(options, choice);
  return (
    <span className={cn("inline-grid shrink-0 gap-1.5", className)}>
      {label && (
        <span id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </span>
      )}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              ref={control}
              aria-label="Speed"
              aria-busy={pending}
              tabIndex={disabled ? 0 : undefined}
              className="speed-select inline-flex min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onAnimationEnd={(event) => event.currentTarget.classList.remove("is-shaking")}
            >
              <Combobox
                value={choice}
                options={options}
                searchable={false}
                wrapOptionLabels
                onOpenChange={setMenuOpen}
                placeholder={choiceLabel}
                disabled={disabled}
                {...(compact
                  ? {
                      trigger: (
                        <SpeedButton
                          label={choiceLabel}
                          choice={choice}
                          disabled={disabled}
                          className={cn(pending && "disabled:opacity-100", triggerClassName)}
                        />
                      ),
                    }
                  : {})}
                {...(label ? { triggerAriaLabelledBy: labelId } : {})}
                onValueChange={(next) => {
                  if (next !== choice) model.onChange(next);
                }}
                triggerClassName={cn("w-36", pending && "disabled:opacity-100", triggerClassName)}
                className="w-max min-w-36 max-w-64"
              />
            </span>
          </TooltipTrigger>
          {!menuOpen && (
            <TooltipContent className="max-w-xs">
              {compact && <p>Speed: {choiceLabel}</p>}
              <p>
                {reason ??
                  "Select processing speed. Higher levels may cost more. Applies to the next turn."}
              </p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function speedLabel(options: ComboboxOption[], choice: string): string {
  return options.find((option) => option.value === choice)?.label ?? choice;
}

function useSpeedError(error: string | null | undefined) {
  const control = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!error || !control.current) return;
    control.current.classList.remove("is-shaking");
    void control.current.offsetWidth;
    control.current.classList.add("is-shaking");
  }, [error]);
  return control;
}

function SpeedButton({
  label,
  choice,
  disabled,
  className,
  ...props
}: {
  label: string;
  choice: string;
} & React.ComponentProps<typeof Button>): ReactElement {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Speed: ${label}`}
      disabled={disabled}
      className={cn("size-7 rounded-lg text-muted-foreground", className)}
    >
      <SpeedIcon choice={choice} />
    </Button>
  );
}

function SpeedIcon({ choice, className }: { choice: string; className?: string }) {
  const Icon = choice === STANDARD_SPEED ? ZapOff : Zap;
  return <Icon aria-hidden="true" data-speed={choice} className={cn("speed-icon", className)} />;
}

function speedOptions({ levels, blockedReason }: SpeedControlModel): ComboboxOption[] {
  return [{ id: STANDARD_SPEED, label: "Standard" }, ...levels].map((level) => {
    const option: ComboboxOption = {
      value: level.id,
      label: level.label,
      icon: <SpeedIcon choice={level.id} className="size-3.5" />,
      disabled: level.id !== STANDARD_SPEED && blockedReason !== undefined,
    };
    if (level.description) option.description = level.description;
    return option;
  });
}
