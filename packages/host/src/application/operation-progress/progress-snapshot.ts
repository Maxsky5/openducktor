export const createProgressSnapshot = <Snapshot extends { revision: number }>(
  initial: Snapshot,
  publish: (snapshot: Snapshot) => void,
) => {
  let current = initial;
  return {
    current: () => current,
    read: () => structuredClone(current),
    commit(next: Snapshot) {
      current = { ...next, revision: current.revision + 1 };
      publish(structuredClone(current));
    },
  };
};
