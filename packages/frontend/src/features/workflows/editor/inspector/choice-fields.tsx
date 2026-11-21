import {
  type WorkflowProblemPath,
  type WorkflowTone,
  workflowToneSchema,
} from "@openducktor/contracts";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Lock, type LucideIcon, Plus } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { laneTheme } from "@/lib/task-status-presentation";
import { cn } from "@/lib/utils";
import { FIELD_LABEL_CLASS, FieldShell, type FieldOption } from "./field-shell";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { SelectField } from "./reference-fields";
import { type ChipColor, ToggleChips } from "./toggle-chips";

type SwitchFieldProps = {
  label: string;
  path: WorkflowProblemPath | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  fixed?: boolean;
};

export function SwitchField({
  label,
  path,
  checked,
  onChange,
  hint,
  fixed = false,
}: SwitchFieldProps): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  return (
    <div
      data-field-path={path === null ? undefined : fieldPathAttribute(path)}
      className="flex items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <Label
          htmlFor={id}
          className={cn(FIELD_LABEL_CLASS, !(readOnly || fixed) && "cursor-pointer")}
        >
          {label}
          {fixed && !readOnly ? (
            <span title="The built-in workflow fixes this value.">
              <Lock aria-hidden="true" className="ml-1.5 inline size-3 align-[-1px]" />
            </span>
          ) : null}
        </Label>
        {hint ? (
          <p className="text-xs leading-5 text-pretty text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={readOnly || fixed}
        className={cn(fixed && !readOnly ? "disabled:opacity-50" : "disabled:opacity-100")}
        onCheckedChange={onChange}
      />
    </div>
  );
}

type CheckboxGroupFieldProps<Value extends string> = {
  label: string;
  path: WorkflowProblemPath;
  values: readonly Value[];
  options: readonly FieldOption<Value>[];
  onChange: (values: Value[]) => void;
  /** The fewest values that the field keeps. The last ones cannot be removed. */
  min?: number;
  hint?: ReactNode;
  /** The icon of an option that is off. */
  Icon?: LucideIcon;
  color?: ChipColor;
};

/**
 * A set from a fixed vocabulary, as chips that turn on and off. The values keep the vocabulary
 * order. An option with a description tells it in a tooltip.
 */
export function CheckboxGroupField<Value extends string>({
  label,
  path,
  values,
  options,
  onChange,
  min = 0,
  hint,
  Icon = Plus,
  color = "sky",
}: CheckboxGroupFieldProps<Value>): ReactElement {
  const id = useId();
  return (
    <FieldShell label={label} path={path} labelId={`${id}-label`} hint={hint}>
      <ToggleChips
        label={label}
        values={values}
        options={options}
        Icon={Icon}
        color={color}
        min={min}
        onChange={(next) => {
          const chosen = new Set(next);
          onChange(options.map(({ value }) => value).filter((value) => chosen.has(value)));
        }}
      />
    </FieldShell>
  );
}

const DEFAULT_CHOICE = "\u0000default";
const booleanOfChoice = (choice: string | undefined): boolean | undefined => {
  if (choice === "on") return true;
  if (choice === "off") return false;
  return undefined;
};
const choiceOfBoolean = (value: boolean | undefined): string => {
  if (value === undefined) return DEFAULT_CHOICE;
  return value ? "on" : "off";
};

/** An optional switch whose default depends on the element. "Default" removes the value. */
export function OptionalBooleanField({
  label,
  path,
  value,
  onChange,
  defaultLabel,
  onLabel = "Yes",
  offLabel = "No",
  hint,
}: {
  label: string;
  path: WorkflowProblemPath;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  defaultLabel: string;
  onLabel?: string;
  offLabel?: string;
  hint?: ReactNode;
}): ReactElement {
  return (
    <SelectField
      label={label}
      path={path}
      value={choiceOfBoolean(value)}
      hint={hint}
      options={[
        { value: DEFAULT_CHOICE, label: defaultLabel },
        { value: "on", label: onLabel },
        { value: "off", label: offLabel },
      ]}
      onChange={(next) => onChange(booleanOfChoice(next))}
    />
  );
}

const TONE_NAMES = {
  neutral: "Grey",
  pending: "Violet",
  info: "Blue",
  warning: "Amber",
  destructive: "Red",
  review: "Indigo",
  approval: "Cyan",
  success: "Green",
} satisfies Record<WorkflowTone, string>;

/** The colour of a state as a row of swatches. Grey is the neutral default. */
export function ToneField({
  path,
  value,
  onChange,
  fixed = false,
}: {
  path: WorkflowProblemPath;
  value: WorkflowTone | undefined;
  onChange: (tone: WorkflowTone | undefined) => void;
  fixed?: boolean;
}): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const current = value ?? "neutral";
  const disabled = readOnly || fixed;
  return (
    <FieldShell label="Colour" path={path} labelId={`${id}-label`} locked={fixed && !readOnly}>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={current}
        disabled={disabled}
        onValueChange={(next) => {
          const tone = workflowToneSchema.parse(next);
          onChange(tone === "neutral" ? undefined : tone);
        }}
        className="flex flex-wrap gap-1.5"
      >
        {workflowToneSchema.options.map((tone) => (
          <Tooltip key={tone}>
            <TooltipTrigger asChild>
              <RadioGroupPrimitive.Item
                value={tone}
                aria-label={TONE_NAMES[tone]}
                className="flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-sidebar transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:not-aria-checked:opacity-30 aria-checked:ring-2 aria-checked:ring-foreground/60"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-4 rounded-full",
                    tone === "neutral"
                      ? "bg-muted-foreground/45"
                      : laneTheme(tone).headerAccentClass,
                  )}
                />
              </RadioGroupPrimitive.Item>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {TONE_NAMES[tone]}
            </TooltipContent>
          </Tooltip>
        ))}
      </RadioGroup>
    </FieldShell>
  );
}
