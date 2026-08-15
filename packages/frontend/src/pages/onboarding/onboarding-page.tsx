import { type ReactElement, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OnboardingLayout, type OnboardingStage } from "./onboarding-layout";
import { RuntimeStage, WelcomeStage, WorkspaceStage } from "./onboarding-stages";
import { useOnboardingRuntimeSetup } from "./use-onboarding-runtime-setup";
import { useOnboardingWorkspaceCompletion } from "./use-onboarding-workspace-completion";

type OnboardingPageProps = {
  onComplete: () => void;
};

export function OnboardingPage({ onComplete }: OnboardingPageProps): ReactElement {
  const [stage, setStage] = useState<OnboardingStage>("welcome");
  const openWorkspaceStage = useCallback((): void => setStage("workspace"), []);
  const runtimeSetup = useOnboardingRuntimeSetup({ onContinue: openWorkspaceStage });
  const workspaceCompletion = useOnboardingWorkspaceCompletion({
    settingsSnapshot: runtimeSetup.settingsSnapshot,
    onComplete,
  });

  return (
    <OnboardingLayout stage={stage}>
      {stage === "welcome" ? <WelcomeStage onContinue={() => setStage("runtimes")} /> : null}
      {stage === "runtimes" ? (
        <RuntimeStage
          runtimeDraft={runtimeSetup.runtimeDraft}
          definitions={runtimeSetup.definitions}
          results={runtimeSetup.checkResults}
          requestError={runtimeSetup.requestError}
          discoveryError={runtimeSetup.discoveryError}
          stageError={runtimeSetup.stageError}
          stageErrorRef={runtimeSetup.stageErrorRef}
          activity={runtimeSetup.activity}
          checkingRuntimeKinds={runtimeSetup.checkingRuntimeKinds}
          showNoRuntimeWarning={runtimeSetup.showNoRuntimeWarning}
          continueDisabled={runtimeSetup.continueDisabled}
          onChange={runtimeSetup.updateDraft}
          onCheckAgain={() => void runtimeSetup.checkAgain()}
          onRetry={runtimeSetup.retryRuntimeRequests}
          onBack={() => setStage("welcome")}
          onContinue={() => void runtimeSetup.saveRuntimes()}
        />
      ) : null}
      {stage === "workspace" ? (
        <WorkspaceStage
          workspaces={workspaceCompletion.workspaces}
          addWorkspace={workspaceCompletion.addFirstWorkspace}
          isFinalizing={workspaceCompletion.isFinalizing}
          onBack={() => setStage("runtimes")}
        />
      ) : null}

      <Dialog
        open={runtimeSetup.confirmNoRuntime}
        onOpenChange={(open) => {
          if (!runtimeSetup.isSaving) runtimeSetup.setConfirmNoRuntime(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue without a coding agent?</DialogTitle>
            <DialogDescription>
              Agent sessions will not work until you configure and enable a valid coding agent in
              Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={runtimeSetup.isSaving}
              onClick={() => runtimeSetup.setConfirmNoRuntime(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={runtimeSetup.isSaving}
              onClick={() => void runtimeSetup.saveRuntimes(true)}
            >
              {runtimeSetup.isSaving ? "Saving..." : "Continue without a coding agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OnboardingLayout>
  );
}
