import type { AgentSessionLiveRef, AgentSessionLiveSnapshot } from "@openducktor/contracts";

export const sessionTreeSnapshots = (
  snapshots: AgentSessionLiveSnapshot[],
  treeRoot?: AgentSessionLiveRef,
): AgentSessionLiveSnapshot[] => {
  if (treeRoot) {
    const ids = new Set([treeRoot.externalSessionId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const snapshot of snapshots)
        if (
          snapshot.parentExternalSessionId &&
          ids.has(snapshot.parentExternalSessionId) &&
          !ids.has(snapshot.ref.externalSessionId)
        ) {
          ids.add(snapshot.ref.externalSessionId);
          expanded = true;
        }
    }
    snapshots = snapshots.filter((snapshot) => ids.has(snapshot.ref.externalSessionId));
  }
  return snapshots;
};
