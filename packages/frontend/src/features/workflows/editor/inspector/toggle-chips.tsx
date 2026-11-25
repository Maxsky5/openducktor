import { Check, type LucideIcon, Plus, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { type ReactElement, type ReactNode, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { FieldShell, type FieldOption } from "./field-shell";
import { toneAccentClass } from "../../state-tone";
import { Dot } from "../panels/outline-group";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { useFocusAfterRemove } from "./use-focus-after-remove";
import type { WorkflowProblemPath } from "@openducktor/contracts";
import { CONTENT_MENU_CLASS } from "../panels/new-element-button";

/**
 * The chosen fill of a chip, in each colour. The borders are solid: a border colour with alpha can
 * take a wrong tint while it animates.
 */
const ON_CLASSES = {
  emerald:
    "border-emerald-300 bg-emerald-500/12 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200",
  violet:
    "border-violet-300 bg-violet-500/12 text-violet-700 dark:border-violet-700 dark:bg-violet-400/15 dark:text-violet-200",
  rose: "border-rose-300 bg-rose-500/12 text-rose-700 dark:border-rose-700 dark:bg-rose-400/15 dark:text-rose-200",
  teal: "border-teal-300 bg-teal-500/12 text-teal-700 dark:border-teal-700 dark:bg-teal-400/15 dark:text-teal-200",
  amber:
    "border-amber-300 bg-amber-500/14 text-amber-800 dark:border-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
  fuchsia:
    "border-fuchsia-300 bg-fuchsia-500/12 text-fuchsia-700 dark:border-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-200",
  indigo:
    "border-indigo-300 bg-indigo-500/12 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200",
  sky: "border-sky-300 bg-sky-500/12 text-sky-700 dark:border-sky-700 dark:bg-sky-400/15 dark:text-sky-200",
} as const;

export type ChipColor = keyof typeof ON_CLASSES;

const chipTitle = (known: boolean, locked: boolean): string | undefined => {
  if (!known) return "This workflow does not have it. Turn it off.";
  return locked ? "Keep at least one." : undefined;
};

type Chip = {
  readonly value: string;
  readonly text: string;
  readonly description: string | undefined;
  readonly group: string;
  readonly known: boolean;
};

/** The chips under their group headings, in the order of their first chip. */
const chipGroups = (chips: readonly Chip[]): { heading: string; chips: Chip[] }[] => {
  const groups = new Map<string, Chip[]>();
  for (const chip of chips) groups.set(chip.group, [...(groups.get(chip.group) ?? []), chip]);
  return [...groups].map(([heading, grouped]) => ({ heading, chips: grouped }));
};

/**
 * Every option as a chip that turns on and off, so the whole choice shows at once, such as the
 * roles of the workflow. The chosen values keep the order of the options. Options with a group
 * show under its heading.
 */
export function ToggleChips({
  label,
  path,
  values,
  options,
  Icon,
  color,
  size = "md",
  min = 0,
  leading,
  chosenClass,
  onChange,
}: {
  label: string;
  /** The field path that problems and focus requests use. A chips field gives it to its shell. */
  path?: WorkflowProblemPath;
  values: readonly string[];
  options: readonly FieldOption[];
  /** The icon of an option that is off. */
  Icon: LucideIcon;
  color: ChipColor;
  /** `sm` fits inside a condition. */
  size?: "sm" | "md";
  /** The fewest chosen values. The last ones cannot turn off. */
  min?: number;
  /** A mark of each option in place of the icon, such as the colour of a state. */
  leading?: ((value: string) => ReactNode) | undefined;
  /** The colour of a chosen chip from a design system style, such as an issue type badge. */
  chosenClass?: ((value: string) => string) | undefined;
  onChange: (values: string[]) => void;
}): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const chosen = new Set(values);
  // A chosen value that the workflow lost stays visible, so the user can turn it off.
  const unknown = values.filter((value) => !options.some((option) => option.value === value));
  const chips: Chip[] = [
    ...options.map(({ value, label: text, description, group }) => ({
      value,
      text,
      description,
      group: group ?? "",
      known: true,
    })),
    ...unknown.map((value) => ({
      value,
      text: value,
      description: undefined,
      group: "",
      known: false,
    })),
  ];
  const groups = options.some(({ group }) => group) ? chipGroups(chips) : null;
  const rowClass = cn("flex flex-wrap", size === "sm" ? "gap-1" : "gap-1.5");
  const toggle = (value: string) =>
    onChange(
      chosen.has(value)
        ? values.filter((other) => other !== value)
        : chips.map((chip) => chip.value).filter((other) => other === value || chosen.has(other)),
    );
  const renderChip = ({ value, text, description, known }: Chip) => {
    const on = chosen.has(value);
    const locked = on && values.length <= min;
    return (
      <button
        key={value}
        type="button"
        role="checkbox"
        aria-checked={on}
        // A locked chip keeps the focus, so a keyboard user also gets the reason it stays.
        disabled={readOnly}
        aria-disabled={locked || undefined}
        title={chipTitle(known, locked) ?? description}
        onClick={() => {
          if (!locked) toggle(value);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default aria-disabled:cursor-not-allowed [&_svg]:size-3.5",
          size === "sm" ? "h-6 px-2.5 text-xs [&_svg]:size-3" : "h-8 px-3 text-[13px]",
          on
            ? (chosenClass?.(value) ?? ON_CLASSES[color])
            : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground",
          !known && "border-destructive-border text-destructive-muted",
        )}
      >
        {/* An unpicked chip dims its mark too, so the picked ones stand out. */}
        {leading ? (
          <span className={cn("inline-flex", !on && "opacity-40")}>{leading(value)}</span>
        ) : null}
        {!leading && on ? <Check aria-hidden="true" /> : null}
        {!leading && !on ? <Icon aria-hidden="true" /> : null}
        {text}
        {leading && on ? <Check aria-hidden="true" className="-mr-0.5" /> : null}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label={label}
      data-field-path={path ? fieldPathAttribute(path) : undefined}
      className={groups ? "flex flex-col gap-2" : rowClass}
    >
      {groups
        ? groups.map(({ heading, chips: grouped }, index) => (
            <div
              key={heading}
              role="group"
              aria-labelledby={heading ? `${id}-${index}` : undefined}
              className="flex flex-col gap-1"
            >
              {heading ? (
                <span id={`${id}-${index}`} className="text-xs text-muted-foreground">
                  {heading}
                </span>
              ) : null}
              <div className={rowClass}>{grouped.map(renderChip)}</div>
            </div>
          ))
        : chips.map(renderChip)}
    </div>
  );
}

/** A labelled set of chips with its hint, or a note when nothing can be chosen yet. */
export function ChipsField({
  label,
  path,
  hint,
  emptyText,
  ...chips
}: Omit<Parameters<typeof ToggleChips>[0], "path"> & {
  path: WorkflowProblemPath;
  hint?: ReactNode;
  /** The note when there is no option, such as how to add one. */
  emptyText?: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <FieldShell label={label} path={path} labelId={id} hint={hint}>
      {chips.options.length === 0 && chips.values.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {emptyText ?? "Nothing to pick yet."}
        </p>
      ) : (
        <ToggleChips label={label} {...chips} />
      )}
    </FieldShell>
  );
}

/** The colour dot of each state, by state ID, for state chips. */
export function useStateDots(): (value: string) => ReactNode {
  const { document } = useInspector();
  const tones = new Map(document.definition.states.map(({ id, tone }) => [id, tone]));
  return (value) => <Dot className={toneAccentClass(tones.get(value) ?? "neutral")} />;
}

/**
 * Only the chosen options as chips, each with a remove button, and an Add pill that lists the
 * others. It fits a condition, where most options stay off.
 */
export function PickedChips({
  label,
  path,
  values,
  options,
  leading,
  onChange,
}: {
  label: string;
  path?: WorkflowProblemPath;
  values: readonly string[];
  options: readonly FieldOption[];
  leading?: ((value: string) => ReactNode) | undefined;
  onChange: (values: string[]) => void;
}): ReactElement {
  const { readOnly } = useInspector();
  const names = new Map(options.map((option) => [option.value, option.label]));
  const chosen = new Set(values);
  const remaining = options.filter((option) => !chosen.has(option.value));
  // A new value takes its place in the option order, as the full chip set does.
  const list = useRef<HTMLDivElement>(null);
  const { markRemoved, markAdded } = useFocusAfterRemove(list);
  const add = (value: string) => {
    if (remaining.length === 1) markAdded();
    onChange(options.map((option) => option.value).filter((id) => id === value || chosen.has(id)));
  };
  return (
    <div
      ref={list}
      role="group"
      aria-label={label}
      data-field-path={path ? fieldPathAttribute(path) : undefined}
      className="flex flex-wrap items-center gap-1"
    >
      {values.map((value, place) => {
        const name = names.get(value);
        return (
          <span
            key={value}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card pr-1 pl-2 text-xs font-medium",
              name === undefined && "border-destructive-border text-destructive-muted",
            )}
            title={name === undefined ? "This workflow does not have it. Remove it." : undefined}
          >
            {leading?.(value)}
            {name ?? value}
            {readOnly ? null : (
              <button
                type="button"
                data-remove-row=""
                aria-label={`Remove ${name ?? value}`}
                className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  markRemoved(place);
                  onChange(values.filter((other) => other !== value));
                }}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {values.length === 0 ? <span className="text-xs text-muted-foreground">None yet</span> : null}
      {readOnly || remaining.length === 0 ? null : (
        <Combobox
          value=""
          options={remaining.map((option) => ({
            value: option.value,
            label: option.label,
            icon: leading?.(option.value),
          }))}
          searchable={remaining.length > 8}
          className={CONTENT_MENU_CLASS}
          listLabel={label}
          closeOnSelect={false}
          onValueChange={add}
          trigger={
            <button
              type="button"
              data-add-row=""
              aria-label={`Add to ${label}`}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus aria-hidden="true" className="size-3" />
              Add
            </button>
          }
        />
      )}
    </div>
  );
}
