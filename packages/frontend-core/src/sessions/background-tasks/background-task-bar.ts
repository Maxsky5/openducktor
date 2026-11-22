import type { AgentSessionBackgroundTask } from "@openducktor/contracts";

/** The transient client state of one Stop request. It never leaves the client. */
export type BackgroundTaskStopRequest =
  | { readonly kind: "stopping" }
  | { readonly kind: "failed"; readonly reason: string };

type BackgroundTaskStopConfirmation = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
};

export type BackgroundTaskRow = {
  readonly taskId: string;
  readonly kind: AgentSessionBackgroundTask["kind"];
  readonly kindLabel: string;
  readonly title: string;
  readonly description: string | null;
  readonly stop: BackgroundTaskStopView;
  readonly confirmation: BackgroundTaskStopConfirmation;
};

export const BACKGROUND_TASKS_LABEL = "Background tasks";

const KIND_LABELS = {
  command: "Command",
  subagent: "Subagent",
  task: "Task",
} satisfies Record<AgentSessionBackgroundTask["kind"], string>;

const backgroundTaskStopConfirmation = (
  task: Pick<AgentSessionBackgroundTask, "kind" | "title">,
): BackgroundTaskStopConfirmation => {
  const kind = KIND_LABELS[task.kind].toLowerCase();
  const effect =
    task.kind === "subagent"
      ? `The subagent "${task.title}" stops before it finishes its work.`
      : `The ${kind} "${task.title}" stops.`;
  return {
    title: `Stop this ${kind}?`,
    description: `${effect} The agent and the other tasks continue.`,
    confirmLabel: "Stop",
  };
};

/** What the Stop part of a background task row shows. */
export type BackgroundTaskStopView = {
  /** The Stop control, or null when the runtime cannot stop this task. */
  readonly control: { readonly label: "Stop" | "Stopping"; readonly busy: boolean } | null;
  /** Why the last Stop failed, or why the runtime cannot stop the task. */
  readonly note: { readonly text: string; readonly tone: "error" | "muted" } | null;
};

const STOP_CONTROL = { label: "Stop", busy: false } as const;

const rowStop = (
  task: AgentSessionBackgroundTask,
  request: BackgroundTaskStopRequest | undefined,
): BackgroundTaskStopView => {
  if (!task.stop.allowed) return { control: null, note: { text: task.stop.reason, tone: "muted" } };
  if (request?.kind === "stopping")
    return { control: { label: "Stopping", busy: true }, note: null };
  if (request?.kind === "failed")
    return { control: STOP_CONTROL, note: { text: request.reason, tone: "error" } };
  return { control: STOP_CONTROL, note: null };
};

/** Rows keep the snapshot order, oldest first. A request of an ended task has no row. */
export const buildBackgroundTaskRows = (
  tasks: ReadonlyArray<AgentSessionBackgroundTask>,
  requests: ReadonlyMap<string, BackgroundTaskStopRequest>,
): BackgroundTaskRow[] =>
  tasks.map((task) => ({
    taskId: task.taskId,
    kind: task.kind,
    kindLabel: KIND_LABELS[task.kind],
    title: task.title,
    description: task.description ?? null,
    stop: rowStop(task, requests.get(task.taskId)),
    confirmation: backgroundTaskStopConfirmation(task),
  }));
