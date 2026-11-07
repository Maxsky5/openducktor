import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { compareBoardTasks } from "@openducktor/workflows";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

export type TaskQueryChange = {
  cards: TaskCard[];
  taskIds: string[];
  removedTaskIds: string[];
  cutoff: number;
};

export type TaskQueryChanges<T> = {
  merge(change: TaskQueryChange): void;
  apply(baseline: T): T;
};

/** Keep one card per task while the first board read is pending. */
export const createBoardChanges = (): TaskQueryChanges<TaskCard[]> => {
  const cards = new Map<string, TaskCard>();
  const removed = new Set<string>();
  // A replaced baseline card stops participating in later visibility windows.
  const baselineCutoffs = new Map<string, number>();
  let cutoff = -Infinity;

  return {
    merge(change) {
      const deleted = new Set(change.removedTaskIds);
      for (const id of deleted) {
        if (!baselineCutoffs.has(id)) baselineCutoffs.set(id, cutoff);
        cards.delete(id);
        removed.add(id);
      }
      for (const card of change.cards) {
        if (deleted.has(card.id)) continue;
        if (!baselineCutoffs.has(card.id)) baselineCutoffs.set(card.id, cutoff);
        cards.set(card.id, card);
      }
      for (const [id, card] of cards) {
        if (card.status === TASK_CLOSED_STATE && Date.parse(card.updatedAt) < change.cutoff) {
          cards.delete(id);
          removed.add(id);
        }
      }
      cutoff = Math.max(cutoff, change.cutoff);
    },
    apply(baseline) {
      const expired = new Set<string>();
      for (const card of baseline) {
        if (card.status !== TASK_CLOSED_STATE) continue;
        if (Date.parse(card.updatedAt) < (baselineCutoffs.get(card.id) ?? cutoff)) {
          expired.add(card.id);
        }
      }
      const byId = new Map<string, TaskCard>();
      for (const card of baseline) {
        if (!removed.has(card.id) && !expired.has(card.id)) byId.set(card.id, card);
      }
      for (const [id, card] of cards) byId.set(id, card);
      return [...byId.values()].sort(compareCards);
    },
  };
};

/** Keep ID insertion order across deletion and recreation without retaining card payloads. */
export const createIdChanges = (): TaskQueryChanges<string[]> => {
  const added = new Set<string>();
  const removed = new Set<string>();
  return {
    merge(change) {
      const deleted = new Set(change.removedTaskIds);
      for (const id of deleted) {
        added.delete(id);
        removed.add(id);
      }
      for (const id of change.taskIds) if (!deleted.has(id)) added.add(id);
    },
    apply(baseline) {
      return [...new Set([...baseline.filter((id) => !removed.has(id)), ...added])];
    },
  };
};

const compareCards = (left: TaskCard, right: TaskCard): number => {
  if (left.sharedState.taskOrder !== right.sharedState.taskOrder)
    return left.sharedState.taskOrder === "priority_then_created" ? -1 : 1;
  return compareBoardTasks(left, right, left.sharedState.taskOrder);
};
