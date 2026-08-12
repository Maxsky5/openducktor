import type { AgentRuntimes, RuntimeExecutableCheckResult } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { WorkspaceCreationForm } from "@/components/features/repository/workspace-creation-form";
import {
  invalidEnabledRuntime,
  RuntimeExecutablePanel,
} from "@/components/features/settings/runtime-executable-panel";
import { prepareSettingsSnapshotForSave } from "@/components/features/settings/settings-save/settings-snapshot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { host } from "@/state/operations/host";
import {
  runtimeDefinitionsQueryOptions,
  runtimeExecutablePaths,
  runtimeExecutablesQueryOptions,
  runtimeQueryKeys,
} from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";

type OnboardingStage = "welcome" | "runtimes" | "workspace";
const stages: Array<{ id: OnboardingStage; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "runtimes", label: "Runtimes" },
  { id: "workspace", label: "Workspace" },
];

export function OnboardingPage(): ReactElement {
  const queryClient = useQueryClient();
  const { workspaces, addWorkspace, saveSettingsSnapshot } = useWorkspaceState();
  const [stage, setStage] = useState<OnboardingStage>("welcome");
  const [runtimeDraft, setRuntimeDraft] = useState<AgentRuntimes | null>(null);
  const [checkResults, setCheckResults] = useState<RuntimeExecutableCheckResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [confirmNoRuntime, setConfirmNoRuntime] = useState(false);
  const explicitRuntimeChoices = useRef(new Set<string>());
  const settingsQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: stage === "runtimes",
  });
  const definitionsQuery = useQuery({
    ...runtimeDefinitionsQueryOptions(),
    enabled: stage === "runtimes",
  });
  const paths = runtimeDraft ? runtimeExecutablePaths(runtimeDraft) : null;
  const validationQuery = useQuery({
    ...runtimeExecutablesQueryOptions(paths ?? { opencode: "", codex: "", claude: "" }),
    enabled: stage === "runtimes" && paths !== null,
  });

  useEffect(() => {
    if (!runtimeDraft && settingsQuery.data) setRuntimeDraft(settingsQuery.data.agentRuntimes);
  }, [runtimeDraft, settingsQuery.data]);
  useEffect(() => {
    if (validationQuery.data) setCheckResults(validationQuery.data.runtimes);
  }, [validationQuery.data]);

  const updateDraft = (next: AgentRuntimes): void => {
    if (runtimeDraft) {
      for (const kind of ["opencode", "codex", "claude"] as const) {
        if (next[kind].enabled !== runtimeDraft[kind].enabled)
          explicitRuntimeChoices.current.add(kind);
      }
    }
    setRuntimeDraft(next);
  };

  const checkAgain = async (): Promise<void> => {
    setIsChecking(true);
    setStageError(null);
    try {
      const checked = await host.runtimeExecutablesCheck({ mode: "discover" });
      setCheckResults(checked.runtimes);
      if (runtimeDraft) {
        const rows = new Map(checked.runtimes.map((row) => [row.kind, row]));
        setRuntimeDraft({
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
        });
      }
    } catch (cause) {
      setStageError(errorMessage(cause));
    } finally {
      setIsChecking(false);
    }
  };

  const saveRuntimes = async (allowNoRuntime = false): Promise<void> => {
    if (!runtimeDraft || !settingsQuery.data) return;
    const invalid = invalidEnabledRuntime(runtimeDraft, checkResults);
    if (invalid) {
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

    setIsSaving(true);
    setStageError(null);
    try {
      await saveSettingsSnapshot(
        prepareSettingsSnapshotForSave({ ...settingsQuery.data, agentRuntimes: runtimeDraft }),
      );
      await queryClient.invalidateQueries({ queryKey: runtimeQueryKeys.all });
      setConfirmNoRuntime(false);
      setStage("workspace");
    } catch (cause) {
      setStageError(errorMessage(cause));
    } finally {
      setIsSaving(false);
    }
  };

  const runtimeLoading =
    settingsQuery.isPending || definitionsQuery.isPending || runtimeDraft === null;
  const runtimeRequestError =
    settingsQuery.error ?? definitionsQuery.error ?? validationQuery.error;

  return (
    <main className="min-h-screen overflow-y-auto bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col gap-6 sm:min-h-[calc(100vh-4rem)]">
        <nav aria-label="Onboarding progress">
          <ol className="grid grid-cols-3 gap-2">
            {stages.map((item, index) => {
              const currentIndex = stages.findIndex((candidate) => candidate.id === stage);
              return (
                <li
                  key={item.id}
                  aria-current={item.id === stage ? "step" : undefined}
                  className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-sm"
                >
                  {index < currentIndex ? <Check aria-hidden="true" /> : <span>{index + 1}</span>}
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="flex flex-1 flex-col">
          {stage === "welcome" ? (
            <>
              <CardHeader>
                <CardTitle>Welcome to OpenDucktor</CardTitle>
                <CardDescription>
                  Plan and deliver repo-scoped work through Spec, Plan, Build, and QA.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-8">
                <div className="flex flex-col gap-3 text-sm text-muted-foreground">
                  <p>
                    OpenDucktor works with a local Git repository and the agent runtimes on this
                    machine.
                  </p>
                  <p>Next, check your runtimes and open your first workspace.</p>
                </div>
                <Button className="self-end" onClick={() => setStage("runtimes")}>
                  Continue <ArrowRight data-icon="inline-end" />
                </Button>
              </CardContent>
            </>
          ) : null}

          {stage === "runtimes" ? (
            <>
              <CardHeader>
                <CardTitle>Configure agent runtimes</CardTitle>
                <CardDescription>Enable the tools that OpenDucktor can use.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-5">
                {runtimeLoading ? (
                  <div
                    className="flex flex-col gap-3"
                    role="status"
                    aria-label="Loading runtime settings"
                  >
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-28 w-full" />
                  </div>
                ) : runtimeRequestError ? (
                  <div className="flex flex-col gap-3" role="alert">
                    <p className="text-sm text-destructive">{errorMessage(runtimeRequestError)}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void settingsQuery.refetch();
                        void definitionsQuery.refetch();
                        void validationQuery.refetch();
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <RuntimeExecutablePanel
                    runtimes={runtimeDraft}
                    definitions={definitionsQuery.data ?? []}
                    results={checkResults}
                    disabled={isSaving}
                    isChecking={isChecking || validationQuery.isFetching}
                    onChange={updateDraft}
                    onCheckAgain={() => void checkAgain()}
                  />
                )}
                {stageError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {stageError}
                  </p>
                ) : null}
                <div className="mt-auto flex justify-between gap-3">
                  <Button variant="outline" onClick={() => setStage("welcome")} disabled={isSaving}>
                    <ArrowLeft data-icon="inline-start" /> Back
                  </Button>
                  <Button onClick={() => void saveRuntimes()} disabled={runtimeLoading || isSaving}>
                    {isSaving ? "Saving..." : "Continue"} <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              </CardContent>
            </>
          ) : null}

          {stage === "workspace" ? (
            <>
              <CardHeader>
                <CardTitle>Open your first workspace</CardTitle>
                <CardDescription>
                  Choose the Git repository that you want to work in.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-5">
                <WorkspaceCreationForm workspaces={workspaces} addWorkspace={addWorkspace} />
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => setStage("runtimes")}
                >
                  <ArrowLeft data-icon="inline-start" /> Back
                </Button>
              </CardContent>
            </>
          ) : null}
        </Card>
      </div>

      <Dialog open={confirmNoRuntime} onOpenChange={setConfirmNoRuntime}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue without an agent runtime?</DialogTitle>
            <DialogDescription>
              Agent sessions will not work until you configure and enable a valid runtime in
              Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNoRuntime(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveRuntimes(true)}>Continue without a runtime</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
