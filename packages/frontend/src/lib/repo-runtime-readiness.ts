import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  classifyRepoRuntimeHealth,
  describeRepoRuntimeStatus,
  type RepoRuntimeHealthReadiness,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";

export type RepoRuntimeReadinessState = "ready" | "checking" | "blocked";

export type RepoRuntimeReadinessSnapshot = {
  state: RepoRuntimeReadinessState;
  message: string | null;
  isLoadingChecks: boolean;
};

export type RepoRuntimeReadinessTarget =
  | { kind: "all" }
  | { kind: "runtime"; runtimeKind: RuntimeKind }
  | { kind: "runtime_set"; runtimeKinds: RuntimeKind[] }
  | { kind: "resolving" }
  | { kind: "inactive" };

export const allRepoRuntimeReadinessTarget = {
  kind: "all",
} satisfies RepoRuntimeReadinessTarget;

export const resolvingRepoRuntimeReadinessTarget = {
  kind: "resolving",
} satisfies RepoRuntimeReadinessTarget;

export const inactiveRepoRuntimeReadinessTarget = {
  kind: "inactive",
} satisfies RepoRuntimeReadinessTarget;

export const repoRuntimeReadinessTargetForRuntime = (
  runtimeKind: RuntimeKind | null | undefined,
): RepoRuntimeReadinessTarget => {
  if (!runtimeKind) {
    return allRepoRuntimeReadinessTarget;
  }

  return { kind: "runtime", runtimeKind };
};

export const repoRuntimeReadinessTargetForRuntimeSet = (
  runtimeKinds: Iterable<RuntimeKind>,
): RepoRuntimeReadinessTarget => ({
  kind: "runtime_set",
  runtimeKinds: Array.from(new Set(runtimeKinds)).sort(),
});

type DeriveRepoRuntimeReadinessArgs = {
  hasActiveWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

type RuntimeReadinessEntry = {
  definition: RuntimeDescriptor;
  runtimeHealth: RepoRuntimeHealthCheck | null | undefined;
  readiness: RepoRuntimeHealthReadiness;
};

const findRuntimeDefinition = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
): RuntimeDescriptor | null => {
  if (!runtimeKind) {
    return null;
  }
  return runtimeDefinitions.find((definition) => definition.kind === runtimeKind) ?? null;
};

const toRuntimeReadinessEntries = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthByRuntime: RepoRuntimeHealthMap,
): RuntimeReadinessEntry[] =>
  runtimeDefinitions.map((definition) => {
    const runtimeHealth = runtimeHealthByRuntime[definition.kind];
    return {
      definition,
      runtimeHealth,
      readiness: classifyRepoRuntimeHealth(runtimeHealth),
    };
  });

const findRuntimeEntryWithReadiness = (
  runtimeEntries: RuntimeReadinessEntry[],
  readiness: RepoRuntimeHealthReadiness,
): RuntimeReadinessEntry | null =>
  runtimeEntries.find((entry) => entry.readiness === readiness) ?? null;

const describeRuntimeEntry = (entry: RuntimeReadinessEntry): string | null =>
  describeRepoRuntimeStatus(entry.definition.label, entry.runtimeHealth ?? null);

const toMissingRuntimeMessage = (runtimeKind: RuntimeKind): string =>
  `Runtime '${runtimeKind}' is not available for agent chat.`;

const readyRepoRuntimeReadiness = (isLoadingChecks: boolean): RepoRuntimeReadinessSnapshot => ({
  state: "ready",
  message: null,
  isLoadingChecks,
});

const checkingRepoRuntimeReadiness = (
  message: string | null,
  isLoadingChecks: boolean,
): RepoRuntimeReadinessSnapshot => ({
  state: "checking",
  message,
  isLoadingChecks,
});

const blockedRepoRuntimeReadiness = (
  message: string,
  isLoadingChecks: boolean,
): RepoRuntimeReadinessSnapshot => ({
  state: "blocked",
  message,
  isLoadingChecks,
});

const readyRuntimeKindsFromEntries = (runtimeEntries: RuntimeReadinessEntry[]): RuntimeKind[] =>
  runtimeEntries
    .filter((entry) => entry.readiness === "ready")
    .map((entry) => entry.definition.kind)
    .sort();

export const deriveSnapshotReadableRepoRuntimeKinds = ({
  hasActiveWorkspace,
  runtimeDefinitions,
  runtimeHealthByRuntime,
  runtimeKinds,
}: {
  hasActiveWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  runtimeKinds: readonly RuntimeKind[];
}): RuntimeKind[] => {
  if (!hasActiveWorkspace || runtimeKinds.length === 0) {
    return [];
  }

  const requiredRuntimeKinds = new Set(runtimeKinds);
  const runtimeEntries = toRuntimeReadinessEntries(
    runtimeDefinitions.filter((definition) => requiredRuntimeKinds.has(definition.kind)),
    runtimeHealthByRuntime,
  );
  return readyRuntimeKindsFromEntries(runtimeEntries);
};

export const deriveRepoRuntimeReadiness = ({
  hasActiveWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  runtimeTarget = allRepoRuntimeReadinessTarget,
}: DeriveRepoRuntimeReadinessArgs): RepoRuntimeReadinessSnapshot => {
  if (runtimeTarget.kind === "inactive") {
    if (!hasActiveWorkspace) {
      return blockedRepoRuntimeReadiness("Select a repository to use agent chat.", isLoadingChecks);
    }

    return readyRepoRuntimeReadiness(isLoadingChecks);
  }

  if (!hasActiveWorkspace) {
    return blockedRepoRuntimeReadiness("Select a repository to use agent chat.", isLoadingChecks);
  }

  const runtimeKind = runtimeTarget.kind === "runtime" ? runtimeTarget.runtimeKind : null;
  const isResolvingRuntimeTarget = runtimeTarget.kind === "resolving";
  const isRequiredRuntimeSet = runtimeTarget.kind === "runtime_set";
  const requiredRuntimeKinds = isRequiredRuntimeSet ? runtimeTarget.runtimeKinds : [];
  const missingRequiredRuntimeKind =
    requiredRuntimeKinds.find((kind) => !findRuntimeDefinition(runtimeDefinitions, kind)) ?? null;
  const targetRuntimeDefinition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  let scopedRuntimeDefinitions: RuntimeDescriptor[];
  if (isRequiredRuntimeSet) {
    scopedRuntimeDefinitions = requiredRuntimeKinds.flatMap((kind) => {
      const definition = findRuntimeDefinition(runtimeDefinitions, kind);
      return definition ? [definition] : [];
    });
  } else if (targetRuntimeDefinition) {
    scopedRuntimeDefinitions = [targetRuntimeDefinition];
  } else if (runtimeKind) {
    scopedRuntimeDefinitions = [];
  } else {
    scopedRuntimeDefinitions = runtimeDefinitions;
  }
  const scopedRuntimeEntries = toRuntimeReadinessEntries(
    scopedRuntimeDefinitions,
    runtimeHealthByRuntime,
  );
  const isRuntimeHealthPending =
    hasActiveWorkspace &&
    scopedRuntimeEntries.length > 0 &&
    scopedRuntimeEntries.some((entry) => entry.runtimeHealth === undefined);
  const healthyRuntime = findRuntimeEntryWithReadiness(scopedRuntimeEntries, "ready");
  const checkingRuntime = findRuntimeEntryWithReadiness(scopedRuntimeEntries, "checking");
  const awaitingStartupRuntime = findRuntimeEntryWithReadiness(
    scopedRuntimeEntries,
    "startup_pending",
  );
  const blockedRuntime = findRuntimeEntryWithReadiness(scopedRuntimeEntries, "blocked");
  const unknownRuntime = findRuntimeEntryWithReadiness(scopedRuntimeEntries, "unknown");

  if (runtimeDefinitionsError) {
    return blockedRepoRuntimeReadiness(runtimeDefinitionsError, isLoadingChecks);
  }
  if (isLoadingRuntimeDefinitions) {
    return checkingRepoRuntimeReadiness("Loading runtime definitions...", isLoadingChecks);
  }
  if (isResolvingRuntimeTarget) {
    return checkingRepoRuntimeReadiness("Resolving selected agent runtime...", isLoadingChecks);
  }
  if (isRequiredRuntimeSet && requiredRuntimeKinds.length === 0) {
    return readyRepoRuntimeReadiness(isLoadingChecks);
  }
  if (missingRequiredRuntimeKind) {
    return blockedRepoRuntimeReadiness(
      toMissingRuntimeMessage(missingRequiredRuntimeKind),
      isLoadingChecks,
    );
  }
  if (runtimeKind && !targetRuntimeDefinition) {
    return blockedRepoRuntimeReadiness(toMissingRuntimeMessage(runtimeKind), isLoadingChecks);
  }
  if (isRequiredRuntimeSet && scopedRuntimeEntries.every((entry) => entry.readiness === "ready")) {
    return readyRepoRuntimeReadiness(isLoadingChecks);
  }
  if (!isRequiredRuntimeSet && healthyRuntime) {
    return readyRepoRuntimeReadiness(isLoadingChecks);
  }
  if (checkingRuntime) {
    return checkingRepoRuntimeReadiness(
      describeRuntimeEntry(checkingRuntime) ?? "Checking runtime health...",
      isLoadingChecks,
    );
  }
  if (awaitingStartupRuntime) {
    return checkingRepoRuntimeReadiness(
      `${awaitingStartupRuntime.definition.label} runtime is starting...`,
      isLoadingChecks,
    );
  }
  if (isLoadingChecks || isRuntimeHealthPending) {
    return checkingRepoRuntimeReadiness("Checking runtime health...", isLoadingChecks);
  }
  if (unknownRuntime) {
    return checkingRepoRuntimeReadiness("Checking runtime health...", isLoadingChecks);
  }
  if (blockedRuntime) {
    return blockedRepoRuntimeReadiness(
      describeRuntimeEntry(blockedRuntime) ?? "No configured runtime is ready for agent chat.",
      isLoadingChecks,
    );
  }

  return blockedRepoRuntimeReadiness(
    runtimeDefinitions.length === 0
      ? "No agent runtimes are available."
      : "No configured runtime is ready for agent chat.",
    isLoadingChecks,
  );
};
