import { TASK_CLOSED_STATE, type WorkflowStateDefinition } from "@openducktor/contracts";
import { elementKey, type WorkflowElementKey } from "@openducktor/workflows";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  type LucideIcon,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_ICON_CLASSES } from "../kind-styles";
import type { ReactElement } from "react";
import { eventRouteLabel, eventRowNames } from "../model/document-elements";
import { eventSenders } from "../model/event-senders";
import { AddTransitionButton } from "../panels/add-transition-button";
import { useInspector } from "./inspector-context";
import { FIELD_LABEL_CLASS } from "./field-shell";

type Row = {
  readonly key: WorkflowElementKey;
  readonly name: string;
  readonly route: string | null;
  readonly resets: boolean;
};

function TransitionRows({
  title,
  Icon,
  rows,
  emptyText,
}: {
  title: string;
  Icon: LucideIcon;
  rows: readonly Row[];
  emptyText: string;
}): ReactElement {
  const { select } = useInspector();
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL_CLASS}>{title}</span>
      {rows.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="group flex items-center gap-2.5 -mx-1.5 w-[calc(100%+0.75rem)] rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={[row.name, row.route].filter(Boolean).join("\n")}
                onClick={() => select(row.key)}
              >
                {row.resets ? (
                  <RotateCcw
                    aria-hidden="true"
                    className={cn("size-3.5 shrink-0", KIND_ICON_CLASSES.rose)}
                  />
                ) : (
                  <Icon
                    aria-hidden="true"
                    className={cn("size-3.5 shrink-0", KIND_ICON_CLASSES.sky)}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{row.name}</span>
                  <span
                    className={
                      row.route
                        ? "truncate text-xs text-muted-foreground"
                        : "truncate text-xs text-warning-muted"
                    }
                  >
                    {row.route ?? "No trigger yet"}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The transitions that bring tasks into a state and take them out of it. A click opens a
 * transition. A new transition starts from this state.
 */
export function StateTransitions({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { document, readOnly, catalogRoles } = useInspector();
  const definition = document.definition;
  const senders = eventSenders(definition);
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  // The route under each row tells rows with the same name apart.
  const names = eventRowNames(definition, roleLabels);
  const rowOf = (event: (typeof definition.events)[number]): Row => ({
    key: elementKey("event", event.id),
    name: names.get(event.id) ?? event.id,
    route: senders.has(event.id) ? eventRouteLabel(definition, event) : null,
    resets: event.effects?.some(({ id }) => id === "worktree.reset") ?? false,
  });
  // A transition from many states can bring tasks in from the others and take them out of this
  // one, so it can show in both lists.
  const incoming = definition.events.filter(
    (event) =>
      event.outcomes.some(({ to }) => to === state.id) && event.from.some((id) => id !== state.id),
  );
  const outgoing = definition.events.filter(
    (event) =>
      event.from.includes(state.id) &&
      event.outcomes.some(({ to }) => to !== null && to !== state.id),
  );
  // The approval button closes the task without a transition, so it brings tasks into Done too.
  const approvals: Row[] =
    state.id === TASK_CLOSED_STATE
      ? definition.actions.flatMap((action) =>
          action.kind === "approval"
            ? [
                {
                  key: elementKey("action", action.id),
                  name: action.label || action.id,
                  route: "Approval button",
                  resets: false,
                },
              ]
            : [],
        )
      : [];
  const name = state.label || state.id;
  return (
    <>
      <TransitionRows
        title="Comes from"
        Icon={ArrowDownLeft}
        rows={[...incoming.map(rowOf), ...approvals]}
        emptyText="No transition moves tasks into this state yet."
      />
      <TransitionRows
        title="Goes to"
        Icon={ArrowUpRight}
        rows={outgoing.map(rowOf)}
        emptyText="No transition moves tasks out of this state yet."
      />
      {readOnly ? null : (
        <AddTransitionButton
          variant="link"
          from={state.id}
          label={`Add a transition from ${name}`}
        />
      )}
    </>
  );
}
