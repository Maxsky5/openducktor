import type { AgentRuntimes, RuntimeKind } from "@openducktor/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { invalidEnabledRuntime } from "@/components/features/settings/runtime-executable-validation";
import { prepareSettingsSnapshotForSave } from "@/components/features/settings/settings-save/settings-snapshot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { preloadKanbanPage } from "@/pages";
import { useWorkspaceState } from "@/state/app-state-provider";
import {
  runtimeDefinitionsQueryOptions,
  runtimeDiscoveryQueryOptions,
  runtimeExecutableQueryOptions,
} from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { OnboardingLayout, type OnboardingStage } from "./onboarding-layout";
import {
  RuntimeStage,
  type RuntimeStageActivity,
  WelcomeStage,
  WorkspaceStage,
} from "./onboarding-stages";

const RUNTIME_KINDS = ["opencode", "codex", "claude"] as const;

function runtimeStageActivity({
  isLoading,
  isValidating,
  isRediscovering,
  isSaving,
}: {
  isLoading: boolean;
  isValidating: boolean;
  isRediscovering: boolean;
  isSaving: boolean;
}): RuntimeStageActivity {
  if (isSaving) return "saving";
  if (isRediscovering) return "rediscovering";
  if (isLoading) return "loading";
  if (isValidating) return "validating";
  return "idle";
}

export function OnboardingPage(): ReactElement {
  const queryClient = useQueryClient();
  const { workspaces, addWorkspace, saveSettingsSnapshot } = useWorkspaceState();
  const [stage, setStage] = useState<OnboardingStage>("welcome");
  const [runtimeDraftOverride, setRuntimeDraftOverride] = useState<AgentRuntimes | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [runtimeDiscoveryError, setRuntimeDiscoveryError] = useState<string | null>(null);
  const [confirmNoRuntime, setConfirmNoRuntime] = useState(false);
  const saveInFlight = useRef(false);
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
  const runtimeDraft = runtimeDraftOverride ?? settingsQuery.data?.agentRuntimes ?? null;
  const validationQueries = useQueries({
    queries: RUNTIME_KINDS.map((kind) => ({
      ...runtimeExecutableQueryOptions(kind, runtimeDraft?.[kind].executablePath ?? ""),
      enabled: runtimeDraft !== null,
    })),
  });
  const opencodeValidationResult = validationQueries[0]?.data;
  const codexValidationResult = validationQueries[1]?.data;
  const claudeValidationResult = validationQueries[2]?.data;
  const checkResults = useMemo(
    () =>
      [opencodeValidationResult, codexValidationResult, claudeValidationResult].filter(
        (result): result is NonNullable<typeof result> => result !== undefined,
      ),
    [claudeValidationResult, codexValidationResult, opencodeValidationResult],
  );
  const checkingRuntimeKinds = RUNTIME_KINDS.filter((_, index) => {
    const query = validationQueries[index];
    return query?.isPending || query?.isFetching;
  });
  const runtimeValidationError = validationQueries.find((query) => query?.error)?.error ?? null;

  useEffect(() => {
    preloadKanbanPage();
  }, []);

  useEffect(() => {
    if (checkResults.length === 0) return;
    const resultsByKind = new Map(checkResults.map((row) => [row.kind, row]));
    setRuntimeDraftOverride((currentOverride) => {
      const current = currentOverride ?? settingsQuery.data?.agentRuntimes;
      if (!current) return currentOverride;
      let next = current;
      for (const kind of RUNTIME_KINDS) {
        const result = resultsByKind.get(kind);
        if (result?.ok !== true) continue;
        const normalizedPathChanged = current[kind].executablePath !== result.path;
        const shouldEnable =
          editedRuntimePaths.current.has(kind) &&
          !explicitRuntimeChoices.current.has(kind) &&
          !current[kind].enabled;
        if (!normalizedPathChanged && !shouldEnable) continue;
        next = {
          ...next,
          [kind]: {
            ...next[kind],
            executablePath: result.path,
            enabled: shouldEnable ? true : next[kind].enabled,
          },
        };
      }
      return next === current ? currentOverride : next;
    });
  }, [checkResults, settingsQuery.data]);

  useEffect(() => {
    if (!stageError || !focusStageError.current) return;
    focusStageError.current = false;
    stageErrorRef.current?.focus();
  }, [stageError]);

  const updateDraft = (next: AgentRuntimes): void => {
    if (runtimeDraft) {
      for (const kind of RUNTIME_KINDS) {
        if (next[kind].enabled !== runtimeDraft[kind].enabled)
          explicitRuntimeChoices.current.add(kind);
        if (next[kind].executablePath !== runtimeDraft[kind].executablePath)
          editedRuntimePaths.current.add(kind);
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
        const nextDraft = {
          ...runtimeDraft,
          opencode: {
            ...runtimeDraft.opencode,
            executablePath: rows.get("opencode")?.path ?? "",
            enabled: explicitRuntimeChoices.current.has("opencode")
              ? runtimeDraft.opencode.enabled
              : rows.get("opencode")?.ok === true,
          },
          codex: {
            ...runtimeDraft.codex,
            executablePath: rows.get("codex")?.path ?? "",
            enabled: explicitRuntimeChoices.current.has("codex")
              ? runtimeDraft.codex.enabled
              : rows.get("codex")?.ok === true,
          },
          claude: {
            ...runtimeDraft.claude,
            executablePath: rows.get("claude")?.path ?? "",
            enabled: explicitRuntimeChoices.current.has("claude")
              ? runtimeDraft.claude.enabled
              : rows.get("claude")?.ok === true,
          },
        };
        setRuntimeDraftOverride(nextDraft);
      }
    } catch (cause) {
      setRuntimeDiscoveryError(errorMessage(cause));
    } finally {
      setIsChecking(false);
    }
  };

  const saveRuntimes = async (allowNoRuntime = false): Promise<void> => {
    if (
      saveInFlight.current ||
      isChecking ||
      runtimeDiscoveryError !== null ||
      !runtimeDraft ||
      !settingsQuery.data ||
      checkingRuntimeKinds.length > 0
    )
      return;
    const invalid = invalidEnabledRuntime(runtimeDraft, checkResults);
    if (invalid) {
      focusStageError.current = false;
      setStageError(invalid.error ?? `${invalid.kind} needs a valid executable path.`);
      document.getElementById(`runtime-executable-${invalid.kind}`)?.focus();
      return;
    }
    const validEnabledCount = checkResults.filter(
      (result) => result.ok && runtimeDraft[result.kind].enabled,
    ).length;
    if (validEnabledCount === 0 && !allowNoRuntime) {
      setConfirmNoRuntime(true);
      return;
    }

    saveInFlight.current = true;
    setIsSaving(true);
    setStageError(null);
    try {
      await saveSettingsSnapshot(
        prepareSettingsSnapshotForSave({ ...settingsQuery.data, agentRuntimes: runtimeDraft }),
      );
      setConfirmNoRuntime(false);
      setStage("workspace");
    } catch (cause) {
      setConfirmNoRuntime(false);
      focusStageError.current = true;
      setStageError(errorMessage(cause));
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  const runtimeLoading =
    settingsQuery.isPending || definitionsQuery.isPending || runtimeDraft === null;
  const validationPending = runtimeDraft !== null && checkingRuntimeKinds.length > 0;
  const runtimeRequestError =
    settingsQuery.error ?? definitionsQuery.error ?? runtimeValidationError;
  const validEnabledRuntimeCount = runtimeDraft
    ? checkResults.filter((result) => result.ok && runtimeDraft[result.kind].enabled).length
    : 0;
  const showNoRuntimeWarning =
    checkResults.length === RUNTIME_KINDS.length &&
    !validationPending &&
    validEnabledRuntimeCount === 0;
  const continueDisabled =
    runtimeLoading ||
    validationPending ||
    isChecking ||
    isSaving ||
    !!runtimeRequestError ||
    runtimeDiscoveryError !== null;
  const runtimeActivity = runtimeStageActivity({
    isLoading: runtimeLoading,
    isValidating: validationPending,
    isRediscovering: isChecking,
    isSaving,
  });

  const retryRuntimeRequests = (): void => {
    void settingsQuery.refetch();
    void definitionsQuery.refetch();
    if (runtimeDraft !== null) {
      for (const query of validationQueries) {
        if (query) void query.refetch();
      }
    }
  };

  return (
    <OnboardingLayout stage={stage}>
      {stage === "welcome" ? <WelcomeStage onContinue={() => setStage("runtimes")} /> : null}
      {stage === "runtimes" ? (
        <RuntimeStage
          runtimeDraft={runtimeDraft}
          definitions={definitionsQuery.data ?? []}
          results={checkResults}
          requestError={runtimeRequestError ? errorMessage(runtimeRequestError) : null}
          discoveryError={runtimeDiscoveryError}
          stageError={stageError}
          stageErrorRef={stageErrorRef}
          activity={runtimeActivity}
          checkingRuntimeKinds={checkingRuntimeKinds}
          showNoRuntimeWarning={showNoRuntimeWarning}
          continueDisabled={continueDisabled}
          onChange={updateDraft}
          onCheckAgain={() => void checkAgain()}
          onRetry={retryRuntimeRequests}
          onBack={() => setStage("welcome")}
          onContinue={() => void saveRuntimes()}
        />
      ) : null}
      {stage === "workspace" ? (
        <WorkspaceStage
          workspaces={workspaces}
          addWorkspace={addWorkspace}
          onBack={() => setStage("runtimes")}
        />
      ) : null}

      <Dialog
        open={confirmNoRuntime}
        onOpenChange={(open) => {
          if (!isSaving) setConfirmNoRuntime(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue without an agent runtime?</DialogTitle>
            <DialogDescription>
              Agent sessions will not work until you configure and enable a valid runtime in
              Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => setConfirmNoRuntime(false)}
            >
              Cancel
            </Button>
            <Button disabled={isSaving} onClick={() => void saveRuntimes(true)}>
              {isSaving ? "Saving..." : "Continue without a runtime"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingLayout>
  );
}
