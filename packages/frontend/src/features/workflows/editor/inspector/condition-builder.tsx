import type { WorkflowCondition, WorkflowProblemPath } from "@openducktor/contracts";
import { ChevronDown, Plus, X } from "lucide-react";
import { type ReactElement, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { TooltipButton } from "../../tooltip-button";
import { KIND_TILE_CLASSES } from "../kind-styles";
import {
  CONDITION_KIND_LABELS,
  CONDITION_KINDS,
  type ConditionKind,
  conditionKind,
  conditionKindBlocker,
  conditionOfKind,
  conditionSentence,
} from "../model/conditions";
import { FieldShell, type FieldOption } from "./field-shell";
import { CONTENT_MENU_CLASS } from "../panels/new-element-button";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { PickedChips, useStateDots } from "./toggle-chips";
import { useFocusAfterRemove } from "./use-focus-after-remove";
import { useStableKeys } from "./use-stable-keys";

/** The colour family of each condition kind: its pill, and the left border of a compound. */
const KIND_STYLES = {
  always: { pill: KIND_TILE_CLASSES.slate, rail: "" },
  never: { pill: KIND_TILE_CLASSES.slate, rail: "" },
  issueType: { pill: KIND_TILE_CLASSES.teal, rail: "border-l-teal-500/60" },
  stateIn: { pill: KIND_TILE_CLASSES.violet, rail: "border-l-violet-500/60" },
  present: { pill: KIND_TILE_CLASSES.rose, rail: "border-l-rose-500/60" },
  absent: { pill: KIND_TILE_CLASSES.rose, rail: "border-l-rose-500/60" },
  verdict: { pill: KIND_TILE_CLASSES.rose, rail: "border-l-rose-500/60" },
  all: { pill: KIND_TILE_CLASSES.indigo, rail: "border-l-indigo-500/60" },
  any: { pill: KIND_TILE_CLASSES.indigo, rail: "border-l-indigo-500/60" },
  not: { pill: KIND_TILE_CLASSES.orange, rail: "border-l-orange-500/60" },
} satisfies Record<ConditionKind, { pill: string; rail: string }>;

type ConditionEditorProps = {
  condition: WorkflowCondition;
  path: WorkflowProblemPath;
  onChange: (condition: WorkflowCondition) => void;
  /** The accessible name of the kind choice. */
  name: string;
  /** Removes this condition from its group. A top condition has no remove button. */
  onRemove?: (() => void) | undefined;
  /** A part of a group. Only the top condition gets a filled box. */
  nested?: boolean;
};

/** Edits one condition and its parts. It offers only declared elements. */
export function ConditionEditor({
  condition,
  path,
  onChange,
  name,
  onRemove,
  nested = false,
}: ConditionEditorProps): ReactElement {
  const { readOnly, document, problemPaths, options } = useInspector();
  const stateDot = useStateDots();
  const definition = document.definition;
  const kind = conditionKind(condition);
  const invalid = problemPaths.has(fieldPathAttribute(path));
  // A test of one value shows its value beside its pill, on one row.
  const inline = kind === "issueType" || kind === "present" || kind === "absent";
  // A group adds its parts from a button beside its pill.
  const group = conditionGroup(condition);

  const reviews = new Set(
    definition.artifacts.filter(({ kind }) => kind === "review").map(({ id }) => id),
  );
  const artifactOptions = (reviewsOnly: boolean): FieldOption[] =>
    options.artifacts.filter(({ value }) => !reviewsOnly || reviews.has(value));

  const pick = (
    label: string,
    fieldPath: WorkflowProblemPath,
    value: string,
    choices: FieldOption[],
    onPick: (value: string) => void,
  ) => {
    const known = choices.some((option) => option.value === value);
    return (
      // Wide enough for a name, so the picker moves under the pill before it cuts one.
      <div
        data-field-path={fieldPathAttribute(fieldPath)}
        className="min-w-[min(100%,13rem)] flex-1"
      >
        <Combobox
          value={value}
          options={[
            ...(known ? [] : [{ value, label: `${value} (not in this workflow)`, disabled: true }]),
            ...choices.map(({ value: id, label: text, icon }) =>
              icon === undefined ? { value: id, label: text } : { value: id, label: text, icon },
            ),
          ]}
          disabled={readOnly}
          searchable={choices.length > 8}
          wrapOptionLabels
          className={CONTENT_MENU_CLASS}
          triggerClassName={cn(
            "h-7 text-xs",
            problemPaths.has(fieldPathAttribute(fieldPath)) && "border-destructive-border",
          )}
          placeholder={label}
          listLabel={label}
          onValueChange={onPick}
        />
      </div>
    );
  };

  const body = (() => {
    if (condition === true || condition === false) return null;
    if ("fact" in condition)
      return pick(
        "Issue type",
        [...path, "equals"],
        String(condition.equals),
        definition.issueTypes.map(({ id, label }) => ({ value: id, label: label || id })),
        (value) => onChange({ fact: "issueType", equals: value }),
      );
    if ("stateIn" in condition)
      return (
        <PickedChips
          label={`${name}: states`}
          path={[...path, "stateIn"]}
          values={condition.stateIn}
          options={definition.states.map(({ id, label }) => ({ value: id, label: label || id }))}
          leading={stateDot}
          onChange={(stateIn) => onChange({ stateIn })}
        />
      );
    if ("artifact" in condition) {
      if (!("verdict" in condition))
        return pick(
          "Artifact",
          [...path, "artifact"],
          condition.artifact,
          artifactOptions(false),
          (artifact) => onChange({ artifact, present: condition.present }),
        );
      const review = definition.artifacts.find(({ id }) => id === condition.artifact);
      const verdicts = review?.kind === "review" ? review.verdicts : [];
      return (
        <div className="flex flex-wrap gap-2 [&>*]:min-w-[min(100%,9rem)]">
          {pick(
            "Review",
            [...path, "artifact"],
            condition.artifact,
            artifactOptions(true),
            (id) => {
              const next = definition.artifacts.find((artifact) => artifact.id === id);
              const verdict = next?.kind === "review" ? next.verdicts[0]!.id : condition.verdict;
              onChange({ artifact: id, verdict });
            },
          )}
          {pick(
            "Verdict",
            [...path, "verdict"],
            condition.verdict,
            verdicts.map(({ id, label }) => ({ value: id, label: label || id })),
            (verdict) => onChange({ artifact: condition.artifact, verdict }),
          )}
        </div>
      );
    }
    if ("not" in condition)
      return (
        <ConditionEditor
          condition={condition.not}
          path={[...path, "not"]}
          name={`${name}, negated part`}
          nested
          onChange={(not) => onChange({ not })}
        />
      );
    return (
      <ConditionGroupParts
        groupKey={"all" in condition ? "all" : "any"}
        parts={"all" in condition ? condition.all : condition.any}
        path={path}
        name={name}
        onChange={onChange}
      />
    );
  })();

  return (
    <div
      data-field-path={fieldPathAttribute(path)}
      // Only a condition with parts gets a coloured rail. A plain choice, such as Always, is a pill.
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        // Only the top condition takes the colour of its kind. Its pill colours each part.
        body !== null &&
          !inline &&
          (nested
            ? "rounded-lg border border-border/60 bg-muted/30 p-2 dark:bg-background/30"
            : cn("border-l-[3px] py-1 pl-2.5", KIND_STYLES[kind].rail)),
        body !== null && !inline && invalid && "border-l-destructive",
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
        <KindPill condition={condition} name={name} invalid={invalid} onChange={onChange} />
        {inline ? body : null}
        {group && !readOnly ? <GroupAddButton group={group} onChange={onChange} /> : null}
        {onRemove && !readOnly ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto size-6 shrink-0 text-muted-foreground"
            data-remove-row=""
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {inline ? null : body}
    </div>
  );
}

/** The kind of a condition as a coloured pill. A click picks another kind. */
function KindPill({
  condition,
  name,
  invalid,
  onChange,
}: {
  condition: WorkflowCondition;
  name: string;
  invalid: boolean;
  onChange: (condition: WorkflowCondition) => void;
}): ReactElement {
  const { readOnly, document } = useInspector();
  const definition = document.definition;
  const kind = conditionKind(condition);
  return (
    <Combobox
      value={kind}
      disabled={readOnly}
      searchable={false}
      className={CONTENT_MENU_CLASS}
      listLabel="Condition kinds"
      options={CONDITION_KINDS.map((option) => {
        const blocker = conditionKindBlocker(option, definition);
        const choice: ComboboxOption = { value: option, label: CONDITION_KIND_LABELS[option] };
        if (blocker) {
          choice.disabled = true;
          choice.description = blocker;
        }
        return choice;
      })}
      onValueChange={(next) => {
        const nextKind = CONDITION_KINDS.find((candidate) => candidate === next);
        if (nextKind && nextKind !== kind)
          onChange(conditionOfKind(nextKind, condition, definition));
      }}
      trigger={
        <button
          type="button"
          aria-label={`${name}: ${CONDITION_KIND_LABELS[kind]}`}
          disabled={readOnly}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
            KIND_STYLES[kind].pill,
            invalid && "ring-1 ring-destructive",
          )}
        >
          {CONDITION_KIND_LABELS[kind]}
          {readOnly ? null : <ChevronDown aria-hidden="true" className="size-3.5 opacity-70" />}
        </button>
      }
    />
  );
}

type ConditionGroup = { kind: "all" | "any"; parts: readonly WorkflowCondition[] };

/** Adds a part that always matches to a group, from beside the pill of the group. */
function GroupAddButton({
  group,
  onChange,
}: {
  group: ConditionGroup;
  onChange: (condition: WorkflowCondition) => void;
}): ReactElement {
  return (
    <TooltipButton
      type="button"
      size="icon"
      variant="ghost"
      className="size-6 shrink-0 text-muted-foreground"
      data-add-row=""
      label={`Add to ${CONDITION_KIND_LABELS[group.kind]}`}
      tooltip="Add a condition"
      onClick={() =>
        onChange(
          group.kind === "all" ? { all: [...group.parts, true] } : { any: [...group.parts, true] },
        )
      }
    >
      <Plus className="size-3.5" />
    </TooltipButton>
  );
}

/** The parts of an all-of or any-of condition. Each part keeps its row while parts move. */
function ConditionGroupParts({
  groupKey,
  parts,
  path,
  name,
  onChange,
}: {
  groupKey: "all" | "any";
  parts: readonly WorkflowCondition[];
  path: WorkflowProblemPath;
  name: string;
  onChange: (condition: WorkflowCondition) => void;
}): ReactElement {
  const rows = useStableKeys(parts);
  // Each part is a condition box: its remove button sits in its first row. Nested parts have
  // their own, so the selector stops at this level.
  const list = useRef<HTMLDivElement>(null);
  const { markRemoved } = useFocusAfterRemove(
    list,
    ":scope > div > div:first-child > [data-remove-row]",
    (root) => root.parentElement?.querySelector<HTMLElement>("[data-add-row]") ?? null,
  );
  const setParts = (next: WorkflowCondition[]) =>
    onChange(groupKey === "all" ? { all: next } : { any: next });
  return (
    <div ref={list} className="flex flex-col gap-2">
      {rows.map(({ item: part, key }, index) => (
        <ConditionEditor
          key={key}
          condition={part}
          path={[...path, groupKey, index]}
          name={`${name}, part ${index + 1}`}
          nested
          onRemove={() => {
            markRemoved(index);
            setParts(parts.filter((_, other) => other !== index));
          }}
          onChange={(next) =>
            setParts(parts.map((current, other) => (other === index ? next : current)))
          }
        />
      ))}
    </div>
  );
}

type ConditionFieldProps = {
  label: string;
  path: WorkflowProblemPath;
  value: WorkflowCondition;
  onChange: (condition: WorkflowCondition) => void;
  hint?: string;
};

/** One shared empty list, so a single test gives the same parts on each render. */
const NO_PARTS: readonly WorkflowCondition[] = [];

/** The parts of an all-of or any-of condition, or null for any other condition. */
const conditionGroup = (condition: WorkflowCondition): ConditionGroup | null => {
  if (condition === true || condition === false) return null;
  if ("all" in condition) return { kind: "all", parts: condition.all };
  if ("any" in condition) return { kind: "any", parts: condition.any };
  return null;
};

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The plain reading of a group, before its tree: one line per part of the top group, since a
 * tree takes a while to read. A single test reads well in its pill, so it gets none.
 */
function ConditionReading({ condition }: { condition: WorkflowCondition }): ReactElement | null {
  const { document } = useInspector();
  const kind = conditionKind(condition);
  const parts = conditionGroup(condition)?.parts ?? NO_PARTS;
  const rows = useStableKeys(parts);
  if (parts.length < 2) return null;
  return (
    <div className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
      <p className="font-medium text-foreground/80">
        {kind === "all" ? "When all of these hold:" : "When any of these holds:"}
      </p>
      <ul className="flex flex-col gap-0.5">
        {rows.map(({ item, key }) => {
          const sentence = capital(conditionSentence(item, document.definition));
          return (
            <li key={key} className="flex gap-1.5" title={sentence}>
              <span aria-hidden="true">•</span>
              <span className="line-clamp-2">{sentence}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A labeled condition of an element. */
export function ConditionField({
  label,
  path,
  value,
  onChange,
  hint,
}: ConditionFieldProps): ReactElement {
  const id = useId();
  return (
    <FieldShell label={label} path={null} labelId={id} hint={hint}>
      <ConditionReading condition={value} />
      <ConditionEditor condition={value} path={path} onChange={onChange} name={label} />
    </FieldShell>
  );
}
