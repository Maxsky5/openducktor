import type { WorkflowProblemPath } from "@openducktor/contracts";
import { Plus } from "lucide-react";
import { type ReactElement, type ReactNode, useId, useRef } from "react";
import { CONTENT_MENU_CLASS, LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { Combobox, type ComboboxGroup, type ComboboxOption } from "@/components/ui/combobox";
import { MoveButtons, RemoveButton } from "../list-row-buttons";
import { moveInList } from "../model/document-edits";
import { FieldShell, type FieldOption, QUIET_CONTROL_CLASS } from "./field-shell";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { useFocusAfterRemove } from "./use-focus-after-remove";
import { useStableKeys } from "./use-stable-keys";

const NONE = "\u0000none";

/** The options under their group headings, in the order of their first option. */
const optionGroups = (options: readonly FieldOption[]): ComboboxGroup[] => {
  const groups = new Map<string, ComboboxOption[]>();
  for (const option of options) {
    const label = option.group ?? "";
    groups.set(label, [...(groups.get(label) ?? []), comboboxOption(option)]);
  }
  return [...groups].map(([label, groupOptions]) => ({ label, options: groupOptions }));
};

/** A field option as a combobox option. A search also matches its secondary label. */
const comboboxOption = ({ value, label, description, secondaryLabel, icon }: FieldOption) => {
  const option: ComboboxOption = { value, label };
  if (description) {
    option.description = description;
    option.searchKeywords = [description];
  }
  if (icon) option.icon = icon;
  if (secondaryLabel) {
    option.secondaryLabel = secondaryLabel;
    option.searchKeywords = [secondaryLabel];
  }
  return option;
};

type SelectFieldProps<Value extends string> = {
  label: string;
  path: WorkflowProblemPath;
  value: Value | undefined;
  options: readonly FieldOption<Value>[];
  onChange: (value: Value | undefined) => void;
  /** The label of the choice that removes the value. Without it, a value is required. */
  noneLabel?: string;
  hint?: ReactNode;
  fixed?: boolean;
  /** `stack` gives the control the full width, for a field that carries the card. */
  layout?: "row" | "stack";
};

/** A choice among declared elements or a fixed vocabulary. An unknown value stays visible. */
export function SelectField<Value extends string>({
  label,
  path,
  value,
  options,
  onChange,
  noneLabel,
  hint,
  fixed = false,
  layout = "stack",
}: SelectFieldProps<Value>): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const known = value === undefined || options.some((option) => option.value === value);
  const extraOptions: ComboboxOption[] = [
    ...(noneLabel === undefined ? [] : [{ value: NONE, label: noneLabel }]),
    ...(known || value === undefined
      ? []
      : [{ value, label: `${value} (not in this workflow)`, disabled: true }]),
  ];
  const comboboxOptions = [...extraOptions, ...options.map(comboboxOption)];
  // Options with a group show under its heading, so two options with one name stay apart.
  const grouped = options.some(({ group }) => group);
  return (
    <FieldShell
      label={label}
      path={path}
      labelId={`${id}-label`}
      hint={hint}
      layout={layout}
      locked={fixed && !readOnly}
    >
      <Combobox
        value={value ?? NONE}
        options={comboboxOptions}
        {...(grouped
          ? { groups: [{ label: "", options: extraOptions }, ...optionGroups(options)] }
          : {})}
        disabled={readOnly || fixed}
        searchable={comboboxOptions.length > 8}
        // A long option wraps, so no choice is cut.
        wrapOptionLabels
        triggerAriaLabelledBy={`${id}-label`}
        triggerClassName={QUIET_CONTROL_CLASS}
        placeholder="Choose…"
        onValueChange={(next) => onChange(options.find((option) => option.value === next)?.value)}
      />
    </FieldShell>
  );
}

type IdListFieldProps = {
  label: string;
  path: WorkflowProblemPath;
  values: readonly string[];
  options: readonly FieldOption[];
  onChange: (values: string[]) => void;
  /** The order counts, so each value can move. */
  ordered?: boolean;
  min?: number;
  hint?: ReactNode;
  addLabel?: string;
  /** What an empty list means, such as "Every role can create the pull request." */
  emptyText?: ReactNode;
};

/**
 * A list of element references. A value that names no declared element shows as missing. An empty
 * list shows what it means. The Add button shows only while an element is left to add.
 */
export function IdListField({
  label,
  path,
  values,
  options,
  onChange,
  ordered = false,
  min = 0,
  hint,
  addLabel = "Add",
  emptyText,
}: IdListFieldProps): ReactElement {
  const { readOnly } = useInspector();
  const id = useId();
  const known = new Map(options.map((option) => [option.value, option]));
  const chosen = new Set(values);
  const remaining = options.filter((option) => !chosen.has(option.value));
  const locked = values.length <= min;
  const rows = useStableKeys(values);
  const list = useRef<HTMLDivElement>(null);
  const { markRemoved, markAdded } = useFocusAfterRemove(list);
  return (
    <FieldShell label={label} path={path} labelId={`${id}-label`} hint={hint}>
      <div ref={list} className="contents">
        {values.length === 0 && emptyText ? (
          <p className="text-xs leading-5 text-muted-foreground">{emptyText}</p>
        ) : null}
        <ul aria-labelledby={`${id}-label`} className="flex flex-col gap-1 empty:hidden">
          {rows.map(({ item: value, key }, index) => {
            const option = known.get(value);
            const name = option?.label ?? value;
            return (
              <li
                key={key}
                data-field-path={fieldPathAttribute([...path, index])}
                className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card py-1 pr-1 pl-2 text-[13px]"
              >
                {ordered ? (
                  <span className="w-3 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate" title={`${name} (${value})`}>
                  {name}
                  {option === undefined ? (
                    <span className="ml-1 text-xs text-destructive-muted">
                      (not in this workflow)
                    </span>
                  ) : null}
                  {option?.group ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">{option.group}</span>
                  ) : null}
                </span>
                {ordered && !readOnly ? (
                  <MoveButtons
                    name={name}
                    canMoveUp={!readOnly && index > 0}
                    canMoveDown={!readOnly && index < values.length - 1}
                    onMove={(offset) => onChange(moveInList(values, index, offset))}
                  />
                ) : null}
                {readOnly ? null : (
                  <RemoveButton
                    name={name}
                    disabled={locked}
                    lockedReason={
                      locked ? "Keep at least one value. Delete the element instead." : undefined
                    }
                    onRemove={() => {
                      markRemoved(index);
                      onChange(values.filter((_, other) => other !== index));
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {readOnly || remaining.length === 0 ? null : (
          <Combobox
            value=""
            options={remaining.map(comboboxOption)}
            {...(remaining.some(({ group }) => group) ? { groups: optionGroups(remaining) } : {})}
            searchable={remaining.length > 8}
            wrapOptionLabels
            className={CONTENT_MENU_CLASS}
            listLabel={label}
            closeOnSelect={false}
            onValueChange={(value) => {
              if (remaining.length === 1) markAdded();
              onChange([...values, value]);
            }}
            trigger={
              <button type="button" data-add-row="" className={LINK_BUTTON_CLASS}>
                <Plus aria-hidden="true" className="size-3.5" />
                {addLabel}
              </button>
            }
          />
        )}
      </div>
    </FieldShell>
  );
}
