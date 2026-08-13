import type {
  AgentRuntimes,
  RuntimeDescriptor,
  RuntimeExecutableCheckResult,
} from "@openducktor/contracts";
import { ArrowLeft, ArrowRight, Bot, FolderGit2, ListChecks, Settings2 } from "lucide-react";
import type { ReactElement, RefObject } from "react";
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
    <Card className="flex max-h-[calc(100vh-15rem)] min-h-[28rem] flex-col overflow-hidden lg:max-h-[calc(100vh-7rem)] lg:min-h-[32rem]">
      <CardHeader className="gap-4 px-6 pt-6 sm:px-8 sm:pt-8">
        <Badge variant="secondary" className="w-fit">
          Welcome to OpenDucktor
        </Badge>
        <div className="flex max-w-2xl flex-col gap-3">
          <CardTitle className="text-3xl leading-tight sm:text-4xl">
            Move from idea to reviewed change.
          </CardTitle>
          <CardDescription className="max-w-xl text-base leading-relaxed">
            OpenDucktor keeps Spec, Plan, Build, and QA tied to one local Git repository.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-7 sm:px-8">
        <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {DELIVERY_PHASES.map((phase, index) => (
            <div key={phase.label} className="flex min-h-28 flex-col gap-3 bg-muted p-4">
              <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
              <div>
                <p className="font-semibold">{phase.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{phase.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid shrink-0 gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
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
          <div className="flex items-start gap-3 rounded-lg border border-border p-4">
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

      <div className="flex justify-end border-t border-border bg-card px-6 py-4 sm:px-8">
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
  showNoRuntimeWarning,
  continueDisabled,
  onChange,
  onCheckAgain,
  onRetry,
  onBack,
  onContinue,
}: RuntimeStageProps): ReactElement {
  const isLoading = activity === "loading";
  const isChecking = activity === "validating" || activity === "rediscovering";
  const isRediscovering = activity === "rediscovering";
  const isSaving = activity === "saving";

  return (
    <Card className="flex max-h-[calc(100vh-15rem)] min-h-[28rem] flex-col lg:max-h-[calc(100vh-7rem)] lg:min-h-[32rem]">
      <CardHeader className="gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
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

      <CardContent className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-5 pt-6 sm:px-8">
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
            isChecking={isChecking}
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

      <div className="flex flex-col-reverse justify-between gap-3 border-t border-border bg-card px-6 py-4 sm:flex-row sm:px-8">
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
  return (
    <Card>
      <CardHeader className="gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
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

      <CardContent className="flex flex-col gap-5 px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
        <div className="rounded-xl bg-muted p-4 sm:p-5">
          <WorkspaceCreationForm workspaces={workspaces} addWorkspace={addWorkspace} />
        </div>
        <div className="flex justify-start">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            Back to runtimes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
