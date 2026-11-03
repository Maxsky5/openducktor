import type {
  ExternalTaskSyncEvent,
  TaskCard as WireTaskCard,
  WorkspaceRef,
} from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { toWireTaskCard } from "../test-support/shared-test-fixtures";

export const boardEvent = (
  scope: WorkspaceRef,
  cards: readonly (TaskCard | WireTaskCard)[],
  options: { removedTaskIds?: string[]; doneVisibleDays?: number } = {},
): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: "event",
  ...scope,
  taskIds: [...new Set([...cards.map((card) => card.id), ...(options.removedTaskIds ?? [])])],
  removedTaskIds: options.removedTaskIds ?? [],
  statusChanges: [],
  taskSnapshots: cards.map(({ id, title, status, workflow }) => ({ id, title, status, workflow })),
  boardChanges: {
    artifactChanges: [],
    cards: cards.map(toWireTaskCard),
    doneVisibleDays: options.doneVisibleDays ?? 1,
  },
  emittedAt: "2026-04-10T13:10:00.000Z",
});

let sequence = 0;
export const eventCursor = (next = ++sequence) => ({
  epoch: "11111111-1111-4111-8111-111111111111",
  sequence: next,
});
