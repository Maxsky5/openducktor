import type {
  AgentRuntimes,
  RuntimeDescriptor,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { ArrowLeft, ArrowRight, Bot, FolderGit2, ListChecks, Settings2 } from "lucide-react";
import { type ReactElement, type RefObject, useState } from "react";
import { WorkspaceCreationForm } from "@/components/features/repository/workspace-creation-form";
import { RuntimeExecutablePanel } from "@/components/features/settings/runtime-executable-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

const DELIVERY_PHASES = [
  { label: "Spec", detail: "Define the outcome" },
  { label: "Plan", detail: "Map the change" },
  { label: "Build", detail: "Make the change" },
  { label: "QA", detail: "Prove the result" },
] as const;

type WelcomeStageProps = {
  onContinue: () => void;
};

export function WelcomeStage({ onContinue }: WelcomeStageProps): ReactElement {
  return (
    <Card className="flex min-h-[34rem] flex-col overflow-hidden shadow-sm">
      <CardHeader className="gap-5 border-b border-border px-6 py-7 sm:px-9 sm:py-9">
        <Badge variant="secondary" className="w-fit">
          Welcome to OpenDucktor
        </Badge>
        <div className="flex max-w-3xl flex-col gap-3">
          <CardTitle className="text-3xl leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
            Move from idea to reviewed change.
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-relaxed sm:text-lg">
            OpenDucktor keeps Spec, Plan, Build, and QA tied to one local Git repository.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-7 bg-muted/20 px-6 py-7 sm:px-9 sm:py-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {DELIVERY_PHASES.map((phase, index) => (
            <div
              key={phase.label}
              className="flex min-h-28 flex-col justify-between gap-3 bg-card p-4 sm:p-5"
            >
              <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
              <div>
                <p className="font-semibold">{phase.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{phase.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 sm:divide-x sm:divide-border">
          <div className="flex items-start gap-3 border-b border-border p-5 sm:border-b-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium">Connect agent runtimes</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Confirm the exact tools and executable paths OpenDucktor can use.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <FolderGit2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium">Open your first workspace</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Choose the local Git repository where work will stay scoped.
              </p>
            </div>
          </div>
        </div>
      </CardContent>

      <div className="flex justify-end border-t border-border bg-card px-6 py-4 sm:px-9">
        <Button size="lg" onClick={onContinue}>
          Continue to runtimes
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </Card>
  );
}

type RuntimeStageProps = {
  runtimeDraft: AgentRuntimes | null;
  definitions: RuntimeDescriptor[];
  results: RuntimeExecutableCheckResult[];
  requestError: string | null;
  discoveryError: string | null;
  stageError: string | null;
  stageErrorRef: RefObject<HTMLParagraphElement | null>;
  activity: RuntimeStageActivity;
  checkingRuntimeKinds: readonly RuntimeKind[];
  showNoRuntimeWarning: boolean;
  continueDisabled: boolean;
  onChange: (next: AgentRuntimes) => void;
  onCheckAgain: () => void;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
};

export type RuntimeStageActivity = "idle" | "loading" | "validating" | "rediscovering" | "saving";

export function RuntimeStage({
  runtimeDraft,
  definitions,
  results,
  requestError,
  discoveryError,
  stageError,
  stageErrorRef,
  activity,
  checkingRuntimeKinds,
  showNoRuntimeWarning,
  continueDisabled,
  onChange,
  onCheckAgain,
  onRetry,
  onBack,
  onContinue,
}: RuntimeStageProps): ReactElement {
  const isLoading = activity === "loading";
  const isRediscovering = activity === "rediscovering";
  const isSaving = activity === "saving";

  return (
    <Card className="flex min-h-[34rem] flex-col overflow-hidden shadow-sm">
      <CardHeader className="gap-3 border-b border-border px-6 py-6 sm:px-9 sm:py-8">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Settings2 className="size-4" aria-hidden="true" />
          Agent tools
        </div>
        <CardTitle className="text-2xl sm:text-3xl">Configure agent runtimes</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-relaxed sm:text-base">
          Choose which runtimes OpenDucktor can use. Every check and agent session will use the
          exact path shown here.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 bg-muted/20 px-6 py-6 sm:px-9">
        {requestError ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-destructive-border bg-destructive-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div>
              <p className="text-sm font-medium text-destructive-surface-foreground">
                Runtime setup could not load
              </p>
              <p className="mt-1 text-sm text-destructive-muted">{requestError}</p>
            </div>
            <Button variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading runtime settings">
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        ) : runtimeDraft ? (
          <RuntimeExecutablePanel
            runtimes={runtimeDraft}
            definitions={definitions}
            results={results}
            disabled={isSaving || isRediscovering}
            isChecking={isRediscovering}
            checkingRuntimeKinds={checkingRuntimeKinds}
            onChange={onChange}
            onCheckAgain={onCheckAgain}
          />
        ) : null}

        {discoveryError ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-destructive-border bg-destructive-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <p className="text-sm text-destructive-muted">{discoveryError}</p>
            <Button variant="outline" onClick={onCheckAgain}>
              Retry runtime detection
            </Button>
          </div>
        ) : null}

        {showNoRuntimeWarning ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-surface p-4"
            role="alert"
          >
            <ListChecks className="mt-0.5 size-4 shrink-0 text-warning-muted" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-warning-surface-foreground">
                No runtime is ready
              </p>
              <p className="mt-1 text-sm text-warning-muted">
                Agent sessions will not work until you configure and enable a valid runtime in
                Settings.
              </p>
            </div>
          </div>
        ) : null}

        {stageError ? (
          <p
            ref={stageErrorRef}
            className="text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="alert"
            tabIndex={-1}
          >
            {stageError}
          </p>
        ) : null}
      </CardContent>

      <div className="flex flex-col-reverse justify-between gap-3 border-t border-border bg-card px-6 py-4 sm:flex-row sm:px-9">
        <Button variant="outline" onClick={onBack} disabled={isSaving || isRediscovering}>
          <ArrowLeft data-icon="inline-start" />
          Back
        </Button>
        <Button size="lg" onClick={onContinue} disabled={continueDisabled}>
          {isSaving ? "Saving runtime setup..." : "Continue to workspace"}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </Card>
  );
}

type WorkspaceStageProps = {
  workspaces: WorkspaceStateContextValue["workspaces"];
  addWorkspace: WorkspaceStateContextValue["addWorkspace"];
  onBack: () => void;
};

export function WorkspaceStage({
  workspaces,
  addWorkspace,
  onBack,
}: WorkspaceStageProps): ReactElement {
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="gap-3 border-b border-border px-6 py-6 sm:px-9 sm:py-8">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <FolderGit2 className="size-4" aria-hidden="true" />
          Repository boundary
        </div>
        <CardTitle className="text-2xl sm:text-3xl">Open your first workspace</CardTitle>
        <CardDescription className="max-w-2xl text-sm leading-relaxed sm:text-base">
          Choose the local Git repository where OpenDucktor will keep tasks, agent sessions, and
          delivery work scoped together.
        </CardDescription>
      </CardHeader>

      <CardContent className="bg-muted/20 px-6 py-6 sm:px-9 sm:py-8">
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <WorkspaceCreationForm
            workspaces={workspaces}
            addWorkspace={addWorkspace}
            repositoryPicker="inline"
            onSubmittingChange={setIsCreatingWorkspace}
          />
        </div>
      </CardContent>
      <div className="flex justify-start border-t border-border bg-card px-6 py-4 sm:px-9">
        <Button variant="outline" onClick={onBack} disabled={isCreatingWorkspace}>
          <ArrowLeft data-icon="inline-start" />
          Back to runtimes
        </Button>
      </div>
    </Card>
  );
}
