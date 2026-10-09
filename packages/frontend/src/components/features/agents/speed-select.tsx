import type { AgentSessionSpeedState, AgentSpeedLevel } from "@openducktor/contracts";
import { Zap, ZapOff } from "lucide-react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import "./speed-select.css";

export type SpeedControlModel = {
  key: string;
  livePresence: AgentSessionState["livePresence"];
  eligibility: "supported" | "unsupported" | "unknown";
  levels: AgentSpeedLevel[] | undefined;
  state: AgentSessionSpeedState;
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
  if (!model || hideSpeed(model)) return null;
  const { state } = model;
  const pending = model.pending || state.synchronization === "pending";
  const disabled = model.disabled || pending;
  const reason = speedReason(model);
  const options = speedOptions(model);
  const choiceLabel = speedLabel(options, state.choice);
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
                value={state.choice ?? ""}
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
                          choice={state.choice}
                          disabled={disabled}
                          className={cn(pending && "disabled:opacity-100", triggerClassName)}
                        />
                      ),
                    }
                  : {})}
                {...(label ? { triggerAriaLabelledBy: labelId } : {})}
                onValueChange={(choice) => {
                  if (choice !== state.choice || state.synchronization !== "confirmed")
                    model.onChange(choice);
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

function speedLabel(options: ComboboxOption[], choice: string | null): string {
  return options.find((option) => option.value === choice)?.label ?? choice ?? "Select speed";
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
  choice: string | null;
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

function SpeedIcon({ choice, className }: { choice: string | null; className?: string }) {
  const Icon = choice === null || choice === "standard" ? ZapOff : Zap;
  return (
    <Icon
      aria-hidden="true"
      data-speed={choice ?? "standard"}
      className={cn("speed-icon", className)}
    />
  );
}

function hideSpeed({ eligibility, state, livePresence }: SpeedControlModel): boolean {
  return (
    eligibility !== "supported" &&
    state.choice === "standard" &&
    (state.synchronization === "confirmed" ||
      (state.synchronization === "unapplied" && livePresence !== "present"))
  );
}

function speedReason({ state, error }: SpeedControlModel): string | undefined {
  if (error) return error;
  if (state.reason) return state.reason.message;
  if (
    (state.processing.status === "cooldown" || state.processing.status === "standard") &&
    state.processing.reason
  )
    return state.processing.reason.message;
  if (state.availability.status !== "available") return state.availability.reason?.message;
  return undefined;
}

function speedOptions({ levels, state, eligibility }: SpeedControlModel): ComboboxOption[] {
  const blocked =
    state.availability.status === "blocked" || state.choice === null || eligibility !== "supported";
  return (levels ?? [{ id: "standard", label: "Standard" }]).map((level) => {
    const option: ComboboxOption = {
      value: level.id,
      label: level.label,
      icon: <SpeedIcon choice={level.id} className="size-3.5" />,
      disabled: level.id !== "standard" && blocked,
    };
    if (level.description) option.description = level.description;
    return option;
  });
}
