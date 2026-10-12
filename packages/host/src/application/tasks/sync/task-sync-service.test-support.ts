import type { ExternalTaskSyncEvent, TaskCard } from "@openducktor/contracts";
import { createDefaultGlobalConfig } from "../../../config/global-config";
import { Effect } from "effect";
import { createTaskEventStream } from "../../../events/task-event-stream";
import { createTaskSyncService } from "./task-sync-service";

type TaskSyncServiceTestInput = Omit<
  Parameters<typeof createTaskSyncService>[0],
  | "onBackgroundFailure"
  | "publicationReporter"
  | "taskEventStream"
  | "taskService"
  | "workspaceSettingsService"
> &
  Partial<
    Pick<Parameters<typeof createTaskSyncService>[0], "onBackgroundFailure" | "publicationReporter">
  > & {
    workspaceSettingsService: Pick<
      Parameters<typeof createTaskSyncService>[0]["workspaceSettingsService"],
      "listWorkspaces"
    > &
      Partial<
        Pick<
          Parameters<typeof createTaskSyncService>[0]["workspaceSettingsService"],
          "getSettingsSnapshot"
        >
      >;
    eventBus: { publish(event: ExternalTaskSyncEvent): void };
    taskService: Omit<Parameters<typeof createTaskSyncService>[0]["taskService"], "listTasks"> &
      Partial<Pick<Parameters<typeof createTaskSyncService>[0]["taskService"], "listTasks">>;
  };

export const createTaskSyncServiceForTest = (input: TaskSyncServiceTestInput) => {
  const stream = createTaskEventStream({ reporter: { report: () => {} } });
  return createTaskSyncService({
    ...input,
    workspaceSettingsService: {
      getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
      ...input.workspaceSettingsService,
    },
    taskService: {
      listTasks: () => Effect.succeed([task(), task({ id: "task-2", title: "Task 2" })]),
      ...input.taskService,
    },
    onBackgroundFailure: input.onBackgroundFailure ?? (() => Effect.void),
    publicationReporter: input.publicationReporter ?? { report: () => Effect.void },
    taskEventStream: {
      publish: (event) => {
        input.eventBus.publish(event);
        return stream.publish(event);
      },
      subscribe: () => {
        throw new Error("unexpected task event stream subscription");
      },
      acknowledge: () => {
        throw new Error("unexpected task event stream acknowledgement");
      },
    },
  });
};
export const createEventBus = () => {
  const events: ExternalTaskSyncEvent[] = [];
  const eventBus = {
    publish(event: ExternalTaskSyncEvent) {
      events.push(event);
    },
    subscribe() {
      throw new Error("unexpected task event stream subscription");
    },
    acknowledge() {
      throw new Error("unexpected task event stream acknowledgement");
    },
  };
  return { eventBus, events };
};

export const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-01-02T03:04:05Z",
  createdAt: "2026-01-01T03:04:05Z",
  ...overrides,
});
