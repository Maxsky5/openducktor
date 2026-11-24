import { STANDARD_SPEED } from "@openducktor/core";
import type { ModelPickerRuntime } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  type ModelSpeedTone,
  speedToneFor,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import { LoaderCircle, Zap, ZapOff } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useModelPickerFocus } from "./model-picker-focus-context";
import { OptionList } from "./model-picker-option-list";
import type { ModelPickerSpeedOptions } from "./model-picker-types";
import {
  StepTrackSlider,
  type StepTrackSliderFill,
  type StepTrackSliderStop,
} from "./step-track-slider";
import "./step-track-slider.css";

const SPEED_TONE_STYLES = {
  standard: {
    fill: { from: "#94a3b8", to: "#64748b", tick: "#e2e8f0" },
    thumbColor: "#475569",
  },
  fast: {
    fill: { from: "#fbbf24", to: "#d97706", tick: "#fde68a" },
    thumbColor: "#d97706",
  },
  ultrafast: {
    fill: { from: "#8b5cf6", to: "#6d28d9", tick: "#c4b5fd" },
    thumbColor: "#7c3aed",
  },
} satisfies Record<ModelSpeedTone, { fill: StepTrackSliderFill; thumbColor: string }>;

type SpeedControlMode = "hidden" | "loading" | "retry" | "unavailable" | "slider" | "list";

type SpeedSectionModel =
  | { mode: "hidden" }
  | { mode: "loading" }
  | { mode: "retry"; error: string; retry: () => void | Promise<void> }
  | { mode: "unavailable"; reason: string }
  | { mode: "slider"; control: SpeedControlModel }
  | { mode: "list"; control: SpeedControlModel };

type ShakeController = {
  ref: React.RefObject<HTMLDivElement | null>;
  onAnimationEnd: () => void;
};

function useShakeOnError(error: string | null | undefined): ShakeController {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!error || !element) {
      return;
    }
    element.classList.remove("is-shaking");
    void element.offsetWidth;
    element.classList.add("is-shaking");
  }, [error]);
  const onAnimationEnd = useCallback(() => {
    ref.current?.classList.remove("is-shaking");
  }, []);
  return { ref, onAnimationEnd };
}

const resolveSpeedSectionModel = ({
  speedOptions,
  runtime,
  isSpeedOnly,
}: {
  speedOptions: ModelPickerSpeedOptions;
  runtime: ModelPickerRuntime | undefined;
  isSpeedOnly: boolean;
}): SpeedSectionModel => {
  const control = speedOptions.control;
  const resource = runtime?.resource;
  const hasVisibleSpeedControl = Boolean(
    control && (control.levels.length > 0 || control.choice !== STANDARD_SPEED),
  );
  if (!hasVisibleSpeedControl || !control) {
    if (!isSpeedOnly || !resource || resource.status === "ready") return { mode: "hidden" };
    if (resource.status === "loading") return { mode: "loading" };
    if (resource.status === "failed") {
      return { mode: "retry", error: resource.error, retry: resource.retry };
    }
    return { mode: "unavailable", reason: resource.reason };
  }
  const isChoiceListed =
    control.choice === STANDARD_SPEED ||
    control.levels.some((level) => level.id === control.choice);
  return {
    mode: isChoiceListed && control.levels.length > 0 ? "slider" : "list",
    control,
  };
};

const renderSpeedThumbIcon = (stop: StepTrackSliderStop): ReactElement => {
  const Icon = stop.value === STANDARD_SPEED ? ZapOff : Zap;
  return (
    <Icon
      aria-hidden="true"
      className="size-3.5"
      style={{ color: SPEED_TONE_STYLES[speedToneFor(stop.value)].thumbColor }}
    />
  );
};

function SpeedAlert({
  alertId,
  message,
  isError,
  className,
}: {
  alertId: string;
  message: string | null;
  isError: boolean;
  className?: string;
}): ReactElement | null {
  if (!message) return null;
  return (
    <p
      id={alertId}
      role={isError ? "alert" : undefined}
      className={cn("text-[11px] leading-snug text-destructive", className)}
    >
      {message}
    </p>
  );
}

function SpeedStatusContent({
  model,
  registerSpeedFocusNode,
}: {
  model: Extract<SpeedSectionModel, { mode: "loading" | "retry" | "unavailable" }>;
  registerSpeedFocusNode: (element: HTMLElement | null) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Speed</span>
        {model.mode === "loading" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            Loading speed options…
          </div>
        ) : model.mode === "unavailable" ? (
          <p className="text-xs text-muted-foreground" role="status">
            {model.reason}
          </p>
        ) : null}
      </div>
      {model.mode === "retry" ? (
        <div className="flex items-center justify-between gap-2" role="alert">
          <p className="text-xs text-destructive">{model.error}</p>
          <Button
            ref={registerSpeedFocusNode}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void model.retry()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SpeedSliderRow({
  control,
  listedStops,
  alertId,
  shake,
  registerSpeedFocusNode,
}: {
  control: SpeedControlModel;
  listedStops: readonly StepTrackSliderStop[];
  alertId: string;
  shake: ShakeController;
  registerSpeedFocusNode: (element: HTMLElement | null) => void;
}): ReactElement {
  const fills = useMemo(
    () => listedStops.map((stop) => SPEED_TONE_STYLES[speedToneFor(stop.value)].fill),
    [listedStops],
  );
  const alertMessage = control.error ?? control.blockedReason ?? null;

  return (
    <>
      <div
        ref={shake.ref}
        onAnimationEnd={shake.onAnimationEnd}
        className="step-track-shake flex items-end gap-2.5"
      >
        <span className="flex h-7 shrink-0 items-center text-xs font-medium text-muted-foreground">
          Speed
        </span>
        <div className="min-w-0 flex-1">
          <StepTrackSlider
            sliderRef={registerSpeedFocusNode}
            stops={listedStops}
            value={control.choice}
            fills={fills}
            ariaLabel="Speed"
            ariaDescribedBy={alertMessage ? alertId : undefined}
            disabled={control.disabled || control.pending}
            busy={control.pending}
            renderThumbIcon={renderSpeedThumbIcon}
            onChange={(next) => {
              if (next !== control.choice) {
                return control.onChange(next);
              }
            }}
          />
        </div>
      </div>
      <SpeedAlert
        alertId={alertId}
        message={alertMessage}
        isError={Boolean(control.error)}
        className="pt-1"
      />
    </>
  );
}

function SpeedFallbackList({
  control,
  listedStops,
  alertId,
  shake,
  registerSpeedFocusNode,
}: {
  control: SpeedControlModel;
  listedStops: readonly StepTrackSliderStop[];
  alertId: string;
  shake: ShakeController;
  registerSpeedFocusNode: (element: HTMLElement | null) => void;
}): ReactElement {
  const activeLabel =
    listedStops.find((stop) => stop.value === control.choice)?.label ?? control.choice;
  const activeTone = speedToneFor(control.choice);
  const disabled = control.disabled || control.pending;
  const alertMessage = control.error ?? control.blockedReason ?? null;

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Speed</span>
        <span
          data-speed-tone={activeTone}
          className={cn(
            "truncate text-xs font-medium",
            activeTone === "standard" ? "text-foreground" : "model-speed-icon",
          )}
        >
          {activeLabel}
        </span>
      </div>
      <div ref={shake.ref} onAnimationEnd={shake.onAnimationEnd} className="step-track-shake">
        <OptionList
          ariaLabel="Speed levels"
          firstSelectableRef={registerSpeedFocusNode}
          items={[
            {
              value: control.choice,
              label: control.choice,
              description: "Current speed (not listed by this model)",
              disabled: true,
              leading: (
                <Zap
                  aria-hidden="true"
                  data-speed-tone={activeTone}
                  className="model-speed-icon size-3.5"
                />
              ),
            },
            ...listedStops.map((stop) => {
              const Icon = stop.value === STANDARD_SPEED ? ZapOff : Zap;
              const stopTone = speedToneFor(stop.value);
              return {
                value: stop.value,
                label: stop.label,
                disabled: disabled || stop.disabled === true,
                leading: (
                  <Icon
                    aria-hidden="true"
                    data-speed-tone={stopTone}
                    className={cn(
                      "size-3.5",
                      stopTone === "standard" ? "text-muted-foreground" : "model-speed-icon",
                    )}
                  />
                ),
              };
            }),
          ]}
          selectedValue={control.choice}
          onSelect={(next) => {
            if (next !== control.choice) {
              control.onChange(next);
            }
          }}
        />
      </div>
      <SpeedAlert alertId={alertId} message={alertMessage} isError={Boolean(control.error)} />
    </div>
  );
}

const isInteractiveSpeedMode = (mode: SpeedControlMode): boolean =>
  mode === "slider" || mode === "list" || mode === "retry";

export function ModelPickerSpeedSection({
  speedOptions,
  runtime,
  isSpeedOnly,
}: {
  speedOptions: ModelPickerSpeedOptions;
  runtime: ModelPickerRuntime | undefined;
  isSpeedOnly: boolean;
}): ReactElement | null {
  const { setSpeedFocusNode, onSpeedSectionHidden } = useModelPickerFocus();
  const alertId = useId();
  const shake = useShakeOnError(speedOptions.control?.error);
  const model = resolveSpeedSectionModel({ speedOptions, runtime, isSpeedOnly });
  const control = model.mode === "slider" || model.mode === "list" ? model.control : null;
  const listedStops = useMemo<readonly StepTrackSliderStop[]>(() => {
    if (!control) return [];
    const blocked = control.blockedReason !== undefined;
    return [
      { value: STANDARD_SPEED, label: "Standard", disabled: false },
      ...control.levels.map((level) => ({
        value: level.id,
        label: level.label,
        disabled: blocked,
      })),
    ];
  }, [control]);

  const sectionRef = useRef<HTMLElement | null>(null);
  const focusControlRef = useRef<HTMLElement | null>(null);
  const hadFocusRef = useRef(false);
  const previousModeRef = useRef<SpeedControlMode>(model.mode);

  const registerSpeedFocusNode = useCallback(
    (node: HTMLElement | null) => {
      focusControlRef.current = node;
      setSpeedFocusNode(node ?? sectionRef.current);
    },
    [setSpeedFocusNode],
  );

  const setSectionElement = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      if (!focusControlRef.current) {
        setSpeedFocusNode(node);
      }
    },
    [setSpeedFocusNode],
  );

  useLayoutEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = model.mode;
    if (previous === model.mode || !hadFocusRef.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !sectionRef.current?.contains(active)) {
      return;
    }
    if (model.mode === "hidden") {
      hadFocusRef.current = false;
      onSpeedSectionHidden();
      return;
    }
    const target = isInteractiveSpeedMode(model.mode)
      ? (focusControlRef.current ?? sectionRef.current)
      : sectionRef.current;
    target?.focus();
  }, [model.mode, onSpeedSectionHidden]);

  if (model.mode === "hidden") return null;

  return (
    <section
      ref={setSectionElement}
      tabIndex={-1}
      aria-label="Speed"
      className="flex min-w-0 flex-col outline-none"
      onFocusCapture={() => {
        hadFocusRef.current = true;
      }}
      onBlurCapture={(event) => {
        const nextFocus = event.relatedTarget;
        if (
          nextFocus !== null &&
          (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus))
        ) {
          hadFocusRef.current = false;
        }
      }}
    >
      {model.mode === "slider" ? (
        <SpeedSliderRow
          control={model.control}
          listedStops={listedStops}
          alertId={alertId}
          shake={shake}
          registerSpeedFocusNode={registerSpeedFocusNode}
        />
      ) : model.mode === "list" ? (
        <SpeedFallbackList
          control={model.control}
          listedStops={listedStops}
          alertId={alertId}
          shake={shake}
          registerSpeedFocusNode={registerSpeedFocusNode}
        />
      ) : (
        <SpeedStatusContent model={model} registerSpeedFocusNode={registerSpeedFocusNode} />
      )}
    </section>
  );
}
