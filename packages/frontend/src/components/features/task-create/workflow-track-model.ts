import { newTaskSteps } from "@openducktor/frontend-core/tasks/create/new-task-steps";
import {
  columnOrder,
  type TaskWorkflow,
  type WorkflowIssueTypeId as IssueType,
  workflowRoleIcon,
} from "@openducktor/workflows";
import { Check, type LucideIcon, User, UserCheck } from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";

export type Station = {
  readonly key: string;
  /** A column is a dot. An agent step is a ring, and a step of the user a rounded square. */
  readonly kind: "column" | "agent" | "person" | "end";
  readonly Icon: LucideIcon | null;
  readonly label: string;
  /** A new task of the type can skip the step. Only the screen reader text tells it. */
  readonly optional: boolean;
};

/** The track of a new task of a type in a workflow, built once for its card. */
export type WorkflowTrackModel = {
  readonly stations: readonly Station[];
  /** The track in words, for a screen reader: "Backlog, then Builder, then QA, then Done". */
  readonly text: string;
};

type Column = TaskWorkflow["definition"]["states"][number];

const columnStation = ({ id, label }: Column): Station => ({
  key: `column-${id}`,
  kind: "column",
  Icon: null,
  label: label || id,
  optional: false,
});

/**
 * The columns that a task of a workflow without steps moves through. From the first column, the
 * path takes the transition to the earliest column in board order that it has not passed, until no
 * transition is left. The last column closes the track, so the path stops before it.
 */
const columnPath = (workflow: TaskWorkflow, columns: readonly Column[]): Column[] => {
  const [first] = columns;
  const last = columns.at(-1);
  if (!first || !last) return [];
  const place = new Map(columns.map(({ id }, index) => [id, index]));
  const targets = new Map<string, number[]>();
  for (const event of workflow.definition.events)
    for (const from of event.from)
      for (const { to } of event.outcomes) {
        const target = to === null ? undefined : place.get(to);
        if (target !== undefined) targets.set(from, [...(targets.get(from) ?? []), target]);
      }
  const path = [first];
  const passed = new Set([0, columns.length - 1]);
  for (let next = 0; ;) {
    const ahead = (targets.get(columns[next]!.id) ?? []).filter((index) => !passed.has(index));
    if (ahead.length === 0) return path;
    next = Math.min(...ahead);
    passed.add(next);
    path.push(columns[next]!);
  }
};

/**
 * The stations of a new task: the first column, each step, the approval of the user, and the last
 * column. A workflow without steps shows the columns that its transitions move the task through.
 */
export const workflowTrackModel = (
  workflow: TaskWorkflow,
  issueType: IssueType,
): WorkflowTrackModel => {
  const columns = columnOrder(workflow.definition.states).map(({ state }) => state);
  const steps = newTaskSteps(workflow, issueType);
  const stations: Station[] =
    steps.length > 0
      ? [
          ...columns.slice(0, 1).map(columnStation),
          ...steps.map((step): Station =>
            step.roleId === null
              ? {
                  key: step.id,
                  kind: "person",
                  Icon: User,
                  label: step.label,
                  optional: step.optional,
                }
              : {
                  key: step.id,
                  kind: "agent",
                  Icon: roleIconForHint(workflowRoleIcon(workflow, step.roleId)),
                  label: step.label,
                  optional: step.optional,
                },
          ),
        ]
      : columnPath(workflow, columns).map(columnStation);
  if (workflow.approvalAction)
    stations.push({
      key: "approval",
      kind: "person",
      Icon: UserCheck,
      label: "You approve",
      optional: false,
    });
  stations.push({
    key: "end",
    kind: "end",
    Icon: Check,
    label: columns.at(-1)?.label || "Done",
    optional: false,
  });
  return {
    stations,
    text: stations
      .map(({ label, optional }) => (optional ? `${label} (optional)` : label))
      .join(", then "),
  };
};
