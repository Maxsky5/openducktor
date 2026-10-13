import type { ExternalTaskSyncEvent, TaskCard } from "@openducktor/contracts";

export const boardEvent = (
  repoPath: string,
  cards: TaskCard[],
  options: { removedTaskIds?: string[]; doneVisibleDays?: number } = {},
): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: "event",
  repoPath,
  taskIds: [...new Set([...cards.map((card) => card.id), ...(options.removedTaskIds ?? [])])],
  removedTaskIds: options.removedTaskIds ?? [],
  statusChanges: [],
  taskSnapshots: cards.map(({ id, title, status }) => ({ id, title, status })),
  boardChanges: { documentChanges: [], cards, doneVisibleDays: options.doneVisibleDays ?? 1 },
  emittedAt: "2026-04-10T13:10:00.000Z",
});

let sequence = 0;
export const eventCursor = (next = ++sequence) => ({
  epoch: "11111111-1111-4111-8111-111111111111",
  sequence: next,
});
