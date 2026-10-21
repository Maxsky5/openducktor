/**
 * The send lifecycle of pending items that a message carries, such as review comments and browser
 * annotations. A send locks the pending items of its snapshot under one submission ID. The send
 * result then settles them: acceptance removes them, and another result restores them.
 */

export type PendingSendItem = {
  id: string;
  revision: number;
  status: "pending" | "submitting";
  submissionId: string | null;
};

export type PendingSendSnapshot = { id: string; revision: number };

const matchesSnapshot = (item: PendingSendItem, snapshot: PendingSendSnapshot): boolean =>
  item.id === snapshot.id && item.revision === snapshot.revision;

/**
 * Locks the pending items whose ID and revision match a snapshot. An item that changed after the
 * snapshot stays pending. Returns null when no item locked.
 */
export const lockPendingItems = <Item extends PendingSendItem>(
  items: readonly Item[],
  snapshots: readonly PendingSendSnapshot[],
  submissionId: string,
): Item[] | null => {
  let locked = false;
  const next = items.map((item): Item => {
    if (
      item.status !== "pending" ||
      !snapshots.some((snapshot) => matchesSnapshot(item, snapshot))
    ) {
      return item;
    }
    locked = true;
    return { ...item, status: "submitting", submissionId };
  });
  return locked ? next : null;
};

/**
 * Settles the items of a submission in every owner. `settle` returns the next item, or null to
 * remove it. Returns null when no owner has an item of the submission.
 */
export const settlePendingItems = <Item extends PendingSendItem>(
  itemsByOwner: Readonly<Record<string, Item[]>>,
  submissionId: string,
  settle: (item: Item, ownerKey: string) => Item | null,
): { itemsByOwner: Record<string, Item[]>; changedOwnerKeys: string[] } | null => {
  if (submissionId.length === 0) return null;
  const next: Record<string, Item[]> = {};
  const changedOwnerKeys: string[] = [];
  for (const [ownerKey, items] of Object.entries(itemsByOwner)) {
    const ofSubmission = (item: Item) =>
      item.status === "submitting" && item.submissionId === submissionId;
    if (!items.some(ofSubmission)) {
      next[ownerKey] = items;
      continue;
    }
    changedOwnerKeys.push(ownerKey);
    next[ownerKey] = items.flatMap((item) => {
      if (!ofSubmission(item)) return [item];
      const settled = settle(item, ownerKey);
      return settled ? [settled] : [];
    });
  }
  return changedOwnerKeys.length > 0 ? { itemsByOwner: next, changedOwnerKeys } : null;
};

/** The item back in the pending list, for a later send. */
export const restorePendingItem = <Item extends PendingSendItem>(item: Item): Item => ({
  ...item,
  status: "pending",
  submissionId: null,
});
