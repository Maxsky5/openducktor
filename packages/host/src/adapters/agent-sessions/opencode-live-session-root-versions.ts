import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { refKey, toSessionRef } from "./opencode-live-session-normalization";
import type { OpenCodeLiveSession } from "./opencode-live-session-state-policy";

export const createOpenCodeLiveSessionRootVersions = (
  findSession: (ref: AgentSessionLiveRef) => OpenCodeLiveSession | undefined,
) => {
  const versionsByRef = new Map<string, number>();

  const rootKeyFor = (ref: AgentSessionLiveRef): string => {
    let session = findSession(ref);
    const visited = new Set<string>();
    while (session?.snapshot.parentExternalSessionId) {
      const parentRef = {
        ...toSessionRef(session.snapshot.ref),
        externalSessionId: session.snapshot.parentExternalSessionId,
      };
      const parentKey = refKey(parentRef);
      if (visited.has(parentKey)) {
        break;
      }
      visited.add(parentKey);
      const parent = findSession(parentRef);
      if (!parent) {
        break;
      }
      session = parent;
    }
    return refKey(session?.snapshot.ref ?? ref);
  };

  return {
    mark: (ref: AgentSessionLiveRef): void => {
      const key = rootKeyFor(ref);
      versionsByRef.set(key, (versionsByRef.get(key) ?? 0) + 1);
    },
    read: (refs: ReadonlyArray<AgentSessionLiveRef>): ReadonlyMap<string, number> =>
      new Map(refs.map((ref) => [refKey(ref), versionsByRef.get(refKey(ref)) ?? 0])),
    selectFresh: <Result extends { readonly ref: AgentSessionLiveRef }>(
      results: ReadonlyArray<Result>,
      readVersions: ReadonlyMap<string, number>,
    ) => {
      const values = results.filter(
        ({ ref }) => readVersions.get(refKey(ref)) === (versionsByRef.get(refKey(ref)) ?? 0),
      );
      const keys = new Set(values.map(({ ref }) => refKey(ref)));
      return {
        values,
        changedKeys: new Set(results.map(({ ref }) => refKey(ref)).filter((key) => !keys.has(key))),
      };
    },
  };
};
