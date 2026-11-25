import type { WorkflowLibraryState } from "@openducktor/contracts";
import { ChevronRight } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import { toneAccentClass } from "../state-tone";

/** The most columns that a strip names. A longer board names its first ones and its last one. */
const SHOWN = 5;

/**
 * The board columns of a workflow in order, each with its colour, such as Backlog › In progress ›
 * Done. A long board shows its first columns, a count of the others, and its last column, so the
 * end of the flow always shows. The tooltip names every column.
 */
/** The columns that a strip names, with one count item in place of the middle columns. */
const shownStates = (
  states: readonly WorkflowLibraryState[],
): (WorkflowLibraryState | { id: string; hidden: number })[] => {
  if (states.length <= SHOWN) return [...states];
  const head = states.slice(0, SHOWN - 2);
  return [...head, { id: "\u0000more", hidden: states.length - head.length - 1 }, states.at(-1)!];
};

export function StatePipeline({
  states,
  className,
}: {
  states: readonly WorkflowLibraryState[];
  className?: string;
}): ReactElement {
  return (
    <ol
      aria-label="Board columns"
      title={states.map(({ label }) => label).join(" › ")}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {shownStates(states).map((state, index) => (
        <Fragment key={state.id}>
          {index > 0 ? (
            <li aria-hidden="true" className="shrink-0 text-muted-foreground/50">
              <ChevronRight className="size-3" />
            </li>
          ) : null}
          {"hidden" in state ? (
            <li className="shrink-0 rounded-full bg-muted px-1.5 tabular-nums">+{state.hidden}</li>
          ) : (
            <li className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", toneAccentClass(state.tone ?? "neutral"))}
              />
              {state.label}
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}
