import type { WorkflowDocument, WorkflowEventDefinition } from "@openducktor/contracts";
import { eventsWithSenders, formatProblemPath, parseElementKey } from "@openducktor/workflows";
import { ChevronUp, CircleCheck, Plus } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { cn } from "@/lib/utils";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import { addBoardButton } from "../model/create-elements";
import { elementKindLabel, elementName, findElement } from "../model/document-elements";
import type { LocatedProblem } from "../model/editor-derivation";
import { messageParts } from "../model/problem-message";
import { ProblemText } from "../problem-text";
import { ProblemMarker } from "./problem-marker";
import { readiness } from "./readiness";

/** The event that a "nothing triggers" warning names, which a board button fixes in one click. */
const untriggeredEvent = (
  document: WorkflowDocument,
  problem: LocatedProblem,
): WorkflowEventDefinition | null => {
  const { kind, id } = parseElementKey(problem.target.key);
  if (kind !== "event" || problem.target.fieldPath.length > 0) return null;
  if (eventsWithSenders(document.definition).has(id)) return null;
  return findElement(document.definition, "event", id) ?? null;
};

/**
 * One problem. A click on the row selects its element and focuses the field. A row names its
 * element in a chip only when the message names nothing itself. A "nothing triggers" row adds a
 * board button in one click, under the message.
 */
function ProblemRow({ problem }: { problem: LocatedProblem }): ReactElement {
  const { store, catalogRoles } = useEditor();
  const document = useEditorState((state) => state.document);
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  const { kind } = parseElementKey(problem.target.key);
  const event = untriggeredEvent(document, problem);
  const namesElement = messageParts(problem.message).some((part) => part.kind !== "text");
  return (
    <li className="rounded-md transition-colors hover:bg-accent">
      <button
        type="button"
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => store.getState().select(problem.target.key, problem.target.fieldPath)}
      >
        <ProblemMarker level={problem.severity} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          {namesElement ? null : (
            <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {elementKindLabel(kind)}: {elementName(document, problem.target.key, roleLabels)}
            </span>
          )}
          <ProblemText message={problem.message} />
        </span>
      </button>
      {event ? (
        <div className="pb-2 pl-7.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              store.getState().change((current) => addBoardButton(current, event));
              // A focus request moves the focus into the details, since this button goes away.
              store.getState().select(problem.target.key, []);
            }}
          >
            <Plus className="size-3.5" />
            Add board button
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The readiness of the draft in one line at the bottom of the canvas. It opens to the problem list
 * when the user asks, or by itself while errors block publication. A click on a problem selects
 * its element and focuses the field.
 */
export function ProblemsPanel(): ReactElement {
  const problems = useEditorView((view) => view.problems);
  const errorCount = useEditorView((view) => view.errorCount);
  const warningCount = useEditorView((view) => view.warningCount);
  const hasDraft = useEditorState((state) => state.hasDraft);
  // The list opens on the first error and stays open until the user closes it, so the canvas
  // does not change height while an edit adds and removes an error.
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  if (chosenOpen === null && errorCount > 0) setChosenOpen(true);
  const ordered = [
    ...problems.filter(({ severity }) => severity === "error"),
    ...problems.filter(({ severity }) => severity === "warning"),
  ];
  const { level, title, detail } = readiness({ errorCount, warningCount, hasDraft });
  const hasList = ordered.length > 0;
  const open = hasList && chosenOpen === true;
  const listId = useId();
  return (
    <section aria-label="Problems" className="border-t border-border bg-card">
      <button
        type="button"
        aria-expanded={hasList ? open : undefined}
        aria-controls={hasList ? listId : undefined}
        disabled={!hasList}
        onClick={() => setChosenOpen(!open)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm transition-colors enabled:hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {level === null ? (
          <CircleCheck
            aria-hidden="true"
            className="size-4 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <ProblemMarker level={level} className="size-4" />
        )}
        <span className="flex min-w-0 flex-1 items-baseline gap-2" aria-live="polite">
          <span className="shrink-0 font-medium">{title}</span>
          {detail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              <span aria-hidden="true">· </span>
              {detail}
            </span>
          ) : null}
        </span>
        {hasList ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {open ? "Hide" : "Show"}
            <ChevronUp
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform duration-200 ease-out",
                open && "rotate-180",
              )}
            />
          </span>
        ) : null}
      </button>
      <CssPresenceReveal open={open}>
        <ul
          id={listId}
          aria-label="Problem list"
          className="max-h-44 overflow-y-auto border-t border-border p-1"
        >
          {ordered.map((problem) => (
            <ProblemRow
              key={`${problem.severity}:${formatProblemPath(problem.path)}:${problem.message}`}
              problem={problem}
            />
          ))}
        </ul>
      </CssPresenceReveal>
    </section>
  );
}
