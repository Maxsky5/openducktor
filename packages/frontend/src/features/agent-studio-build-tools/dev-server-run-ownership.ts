import type {
  DevServerGroupState,
  DevServerRunIdentity,
  DevServerScriptState,
} from "@openducktor/contracts";

type DevServerRunOwner = {
  runIdentity: DevServerRunIdentity | null;
};

type DevServerRunOwnershipStore = ReadonlyMap<string, DevServerRunOwner>;

export type DevServerRunOrderRelation = "foreign" | "newer" | "older" | "same";

export const areDevServerRunIdentitiesEqual = (
  left: DevServerRunIdentity | null,
  right: DevServerRunIdentity | null,
): boolean => {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.runId !== right.runId) {
    return false;
  }
  if (
    left.runOrder.hostInstanceId !== right.runOrder.hostInstanceId ||
    left.runOrder.generation !== right.runOrder.generation
  ) {
    throw new Error(`Dev server run ${left.runId} has conflicting order metadata.`);
  }
  return true;
};

export const compareDevServerRunIdentity = (
  current: DevServerRunIdentity | null,
  candidate: DevServerRunIdentity | null,
): DevServerRunOrderRelation => {
  if (areDevServerRunIdentitiesEqual(current, candidate)) {
    return "same";
  }
  if (candidate === null) {
    return "older";
  }
  if (current === null) {
    return "newer";
  }
  if (candidate.runOrder.hostInstanceId !== current.runOrder.hostInstanceId) {
    return "foreign";
  }
  if (candidate.runOrder.generation === current.runOrder.generation) {
    throw new Error(
      `Dev server runs ${current.runId} and ${candidate.runId} share generation ${candidate.runOrder.generation}.`,
    );
  }
  return candidate.runOrder.generation > current.runOrder.generation ? "newer" : "older";
};

const readDevServerStoreHostInstanceId = (store: DevServerRunOwnershipStore): string | null => {
  const hostInstanceIds = new Set<string>();
  for (const owner of store.values()) {
    if (owner.runIdentity !== null) {
      hostInstanceIds.add(owner.runIdentity.runOrder.hostInstanceId);
    }
  }

  if (hostInstanceIds.size > 1) {
    throw new Error("Dev server terminal buffers contain conflicting host ownership.");
  }

  return hostInstanceIds.values().next().value ?? null;
};

export const canApplyDevServerRunIdentityToStore = (
  store: DevServerRunOwnershipStore,
  candidate: DevServerRunIdentity,
): boolean => {
  const currentHostInstanceId = readDevServerStoreHostInstanceId(store);
  return (
    currentHostInstanceId === null || currentHostInstanceId === candidate.runOrder.hostInstanceId
  );
};

export const canApplyDevServerScriptStateToStore = (
  store: DevServerRunOwnershipStore,
  script: DevServerScriptState,
): boolean => {
  if (
    script.runIdentity !== null &&
    !canApplyDevServerRunIdentityToStore(store, script.runIdentity)
  ) {
    return false;
  }

  const current = store.get(script.scriptId);
  if (!current) {
    return true;
  }

  const relation = compareDevServerRunIdentity(current.runIdentity, script.runIdentity);
  return relation === "same" || relation === "newer";
};

export const canApplyDevServerGroupState = (
  store: DevServerRunOwnershipStore,
  state: DevServerGroupState,
): boolean => {
  const candidateHostInstanceIds = new Set<string>();
  for (const script of state.scripts) {
    if (script.runIdentity !== null) {
      candidateHostInstanceIds.add(script.runIdentity.runOrder.hostInstanceId);
    }
  }

  if (candidateHostInstanceIds.size > 1) {
    throw new Error("Dev server group state contains conflicting host ownership.");
  }

  const candidateHostInstanceId = candidateHostInstanceIds.values().next().value ?? null;
  const currentHostInstanceId = readDevServerStoreHostInstanceId(store);
  if (
    candidateHostInstanceId !== null &&
    currentHostInstanceId !== null &&
    candidateHostInstanceId !== currentHostInstanceId
  ) {
    return false;
  }

  return state.scripts.every((script) => canApplyDevServerScriptStateToStore(store, script));
};
