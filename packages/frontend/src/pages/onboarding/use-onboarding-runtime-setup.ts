import {
  type AgentRuntimes,
  knownRuntimeKindValues,
  type RuntimeKind,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { prepareSettingsSnapshotForSave } from "@/components/features/settings/settings-save/settings-snapshot";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { replaceRuntimeExecutablePaths } from "@/state/operations/runtime-executables/runtime-executable-draft";
import { invalidEnabledRuntime } from "@/state/operations/runtime-executables/runtime-executable-validation";
import {
  runtimeDefinitionsQueryOptions,
  runtimeDiscoveryQueryOptions,
} from "@/state/queries/runtime";
import {
  type RuntimeExecutableValidationResult,
  useRuntimeExecutableValidation,
} from "@/state/queries/use-runtime-executable-validation";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { RuntimeStageActivity } from "./onboarding-stages";

const runtimeStageActivity = ({
  isLoading,
  isValidating,
  isRediscovering,
}: {
  isLoading: boolean;
  isValidating: boolean;
  isRediscovering: boolean;
}): RuntimeStageActivity => {
  if (isRediscovering) return "rediscovering";
  if (isLoading) return "loading";
  if (isValidating) return "validating";
  return "idle";
};

type SavingStageSnapshot = {
  checkResults: RuntimeExecutableValidationResult[];
  checkingRuntimeKinds: RuntimeKind[];
  activity: RuntimeStageActivity;
  showNoRuntimeWarning: boolean;
  continueDisabled: boolean;
};

export const useOnboardingRuntimeSetup = ({ onContinue }: { onContinue: () => void }) => {
  const queryClient = useQueryClient();
  const { saveSettingsSnapshot } = useWorkspaceState();
  const [runtimeDraftOverride, setRuntimeDraftOverride] = useState<AgentRuntimes | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [runtimeDiscoveryError, setRuntimeDiscoveryError] = useState<string | null>(null);
  const [confirmNoRuntime, setConfirmNoRuntime] = useState(false);
  const saveInFlight = useRef(false);
  const savingStageSnapshotRef = useRef<SavingStageSnapshot>(null);
  const stageErrorRef = useRef<HTMLParagraphElement>(null);
  const focusStageError = useRef(false);
  const explicitRuntimeChoices = useRef(new Set<RuntimeKind>());
  const editedRuntimePaths = useRef(new Set<RuntimeKind>());
  const settingsQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: true,
  });
  const definitionsQuery = useQuery({
    ...runtimeDefinitionsQueryOptions(),
    enabled: true,
  });
  const savedAgentRuntimes = settingsQuery.data?.agentRuntimes;
  const runtimeDraft = runtimeDraftOverride ?? savedAgentRuntimes ?? null;
  const runtimeValidation = useRuntimeExecutableValidation(runtimeDraft, runtimeDraft !== null);
  const checkResults = runtimeValidation.results;
  const checkingRuntimeKinds = runtimeValidation.checkingRuntimeKinds;

  useEffect(() => {
    if (checkResults.length === 0) return;
    const resultsByKind = new Map(checkResults.map((row) => [row.kind, row]));
    setRuntimeDraftOverride((currentOverride) => {
      const current = currentOverride ?? savedAgentRuntimes;
      if (!current) return currentOverride;
      let next = current;
      for (const kind of knownRuntimeKindValues) {
        const result = resultsByKind.get(kind);
        if (result?.ok !== true) continue;
        const shouldEnable =
          editedRuntimePaths.current.has(kind) &&
          !explicitRuntimeChoices.current.has(kind) &&
          !current[kind].enabled;
        if (!shouldEnable) continue;
        next = {
          ...next,
          [kind]: { ...next[kind], enabled: true },
        };
      }
      return next === current ? currentOverride : next;
    });
  }, [checkResults, savedAgentRuntimes]);

  useEffect(() => {
    if (!stageError || !focusStageError.current) return;
    focusStageError.current = false;
    stageErrorRef.current?.focus();
  }, [stageError]);

  const updateDraft = (next: AgentRuntimes): void => {
    if (runtimeDraft) {
      for (const kind of knownRuntimeKindValues) {
        if (next[kind].enabled !== runtimeDraft[kind].enabled) {
          explicitRuntimeChoices.current.add(kind);
        }
        if (next[kind].executablePath !== runtimeDraft[kind].executablePath) {
          editedRuntimePaths.current.add(kind);
        }
      }
    }
    setRuntimeDraftOverride(next);
  };

  const checkAgain = async (): Promise<void> => {
    setIsChecking(true);
    setStageError(null);
    setRuntimeDiscoveryError(null);
    try {
      const checked = await queryClient.fetchQuery(runtimeDiscoveryQueryOptions());
      if (runtimeDraft) {
        const rows = new Map(checked.runtimes.map((row) => [row.kind, row]));
        let nextDraft = replaceRuntimeExecutablePaths(runtimeDraft, checked.runtimes);
        for (const kind of knownRuntimeKindValues) {
          if (explicitRuntimeChoices.current.has(kind)) continue;
          nextDraft = {
            ...nextDraft,
            [kind]: { ...nextDraft[kind], enabled: rows.get(kind)?.ok === true },
          };
        }
        setRuntimeDraftOverride(nextDraft);
      }
    } catch (cause) {
      setRuntimeDiscoveryError(errorMessage(cause));
    } finally {
      setIsChecking(false);
    }
  };

  const runtimeLoading =
    settingsQuery.isPending || definitionsQuery.isPending || runtimeDraft === null;
  const validationPending = runtimeDraft !== null && checkingRuntimeKinds.length > 0;
  const runtimeRequestError =
    settingsQuery.error ?? definitionsQuery.error ?? runtimeValidation.error;
  const validEnabledRuntimeCount = runtimeDraft
    ? checkResults.filter((result) => result.ok && runtimeDraft[result.kind].enabled).length
    : 0;
  const showNoRuntimeWarning =
    checkResults.length === knownRuntimeKindValues.length &&
    !validationPending &&
    validEnabledRuntimeCount === 0;
  const activity = runtimeStageActivity({
    isLoading: runtimeLoading,
    isValidating: validationPending,
    isRediscovering: isChecking,
  });
  const continueDisabled =
    runtimeLoading ||
    validationPending ||
    isChecking ||
    !!runtimeRequestError ||
    runtimeDiscoveryError !== null;

  const saveRuntimes = async (allowNoRuntime = false): Promise<void> => {
    if (
      saveInFlight.current ||
      isChecking ||
      runtimeDiscoveryError !== null ||
      !runtimeDraft ||
      !settingsQuery.data ||
      checkingRuntimeKinds.length > 0
    ) {
      return;
    }
    const invalid = invalidEnabledRuntime(runtimeDraft, checkResults);
    if (invalid) {
      focusStageError.current = false;
      setStageError(invalid.error ?? `${invalid.kind} needs a valid executable path.`);
      document.getElementById(`runtime-executable-${invalid.kind}`)?.focus();
      return;
    }
    if (validEnabledRuntimeCount === 0 && !allowNoRuntime) {
      setConfirmNoRuntime(true);
      return;
    }

    saveInFlight.current = true;
    savingStageSnapshotRef.current = {
      checkResults,
      checkingRuntimeKinds,
      activity,
      showNoRuntimeWarning,
      continueDisabled,
    };
    setIsSaving(true);
    setStageError(null);
    try {
      await saveSettingsSnapshot(
        prepareSettingsSnapshotForSave({ ...settingsQuery.data, agentRuntimes: runtimeDraft }),
      );
      setConfirmNoRuntime(false);
      onContinue();
    } catch (cause) {
      setConfirmNoRuntime(false);
      focusStageError.current = true;
      setStageError(errorMessage(cause));
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
      savingStageSnapshotRef.current = null;
    }
  };

  const visibleStageSnapshot = isSaving ? savingStageSnapshotRef.current : null;

  const retryRuntimeRequests = (): void => {
    void settingsQuery.refetch();
    void definitionsQuery.refetch();
    if (runtimeDraft !== null) {
      void runtimeValidation.refetch();
    }
  };

  return {
    settingsSnapshot: settingsQuery.data,
    runtimeDraft,
    definitions: definitionsQuery.data ?? [],
    checkResults: visibleStageSnapshot?.checkResults ?? checkResults,
    checkingRuntimeKinds: visibleStageSnapshot?.checkingRuntimeKinds ?? checkingRuntimeKinds,
    requestError: runtimeRequestError ? errorMessage(runtimeRequestError) : null,
    discoveryError: runtimeDiscoveryError,
    stageError,
    stageErrorRef,
    activity: visibleStageSnapshot?.activity ?? activity,
    showNoRuntimeWarning: visibleStageSnapshot?.showNoRuntimeWarning ?? showNoRuntimeWarning,
    continueDisabled: visibleStageSnapshot?.continueDisabled ?? continueDisabled,
    confirmNoRuntime,
    isSaving,
    updateDraft,
    checkAgain,
    retryRuntimeRequests,
    saveRuntimes,
    setConfirmNoRuntime,
  };
};
