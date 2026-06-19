import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  describeRepoRuntimeStatus,
  isRepoRuntimeReady,
  isRepoRuntimeStartupPending,
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

type DeriveRepoRuntimeReadinessArgs = {
  hasActiveWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

const getBlockedRuntimeReason = (
  runtimeLabel: string,
  runtimeHealth: RepoRuntimeHealthCheck | null,
): string | null => {
  if (!runtimeHealth) {
    return null;
  }
  return describeRepoRuntimeStatus(runtimeLabel, runtimeHealth);
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
  const targetRuntimeDefinition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  const scopedRuntimeDefinitions = targetRuntimeDefinition
    ? [targetRuntimeDefinition]
    : runtimeKind
      ? []
      : runtimeDefinitions;
  const isRuntimeHealthPending =
    hasActiveWorkspace &&
    scopedRuntimeDefinitions.length > 0 &&
    scopedRuntimeDefinitions.some(
      (definition) => runtimeHealthByRuntime[definition.kind] === undefined,
    );
  const healthyRuntimeDefinition =
    scopedRuntimeDefinitions.find((definition) =>
      isRepoRuntimeReady(runtimeHealthByRuntime[definition.kind] ?? null),
    ) ?? null;
  const checkingRuntimeDefinition =
    scopedRuntimeDefinitions.find(
      (definition) => runtimeHealthByRuntime[definition.kind]?.status === "checking",
    ) ?? null;
  const awaitingStartupRuntimeDefinition =
    scopedRuntimeDefinitions.find((definition) =>
      isRepoRuntimeStartupPending(runtimeHealthByRuntime[definition.kind] ?? null),
    ) ?? null;
  const blockedRuntimeDefinition =
    scopedRuntimeDefinitions.find((definition) => {
      const runtimeHealth = runtimeHealthByRuntime[definition.kind];
      return Boolean(
        runtimeHealth &&
          runtimeHealth.status !== "ready" &&
          runtimeHealth.status !== "checking" &&
          !isRepoRuntimeStartupPending(runtimeHealth),
      );
    }) ?? null;
  const blockedRuntimeHealth = blockedRuntimeDefinition
    ? (runtimeHealthByRuntime[blockedRuntimeDefinition.kind] ?? null)
    : null;

  if (runtimeDefinitionsError) {
    return blockedRepoRuntimeReadiness(runtimeDefinitionsError, isLoadingChecks);
  }
  if (isLoadingRuntimeDefinitions) {
    return checkingRepoRuntimeReadiness("Loading runtime definitions...", isLoadingChecks);
  }
  if (isResolvingRuntimeTarget) {
    return checkingRepoRuntimeReadiness("Resolving selected agent runtime...", isLoadingChecks);
  }
  if (runtimeKind && !targetRuntimeDefinition) {
    return blockedRepoRuntimeReadiness(
      `Runtime '${runtimeKind}' is not available for agent chat.`,
      isLoadingChecks,
    );
  }
  if (healthyRuntimeDefinition) {
    return readyRepoRuntimeReadiness(isLoadingChecks);
  }
  if (checkingRuntimeDefinition) {
    return checkingRepoRuntimeReadiness(
      getBlockedRuntimeReason(
        checkingRuntimeDefinition.label,
        runtimeHealthByRuntime[checkingRuntimeDefinition.kind] ?? null,
      ) ?? "Checking runtime health...",
      isLoadingChecks,
    );
  }
  if (awaitingStartupRuntimeDefinition) {
    return checkingRepoRuntimeReadiness(
      `${awaitingStartupRuntimeDefinition.label} runtime is starting...`,
      isLoadingChecks,
    );
  }
  if (isLoadingChecks || isRuntimeHealthPending) {
    return checkingRepoRuntimeReadiness("Checking runtime health...", isLoadingChecks);
  }
  if (blockedRuntimeDefinition) {
    return blockedRepoRuntimeReadiness(
      getBlockedRuntimeReason(blockedRuntimeDefinition.label, blockedRuntimeHealth) ??
        "No configured runtime is ready for agent chat.",
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
