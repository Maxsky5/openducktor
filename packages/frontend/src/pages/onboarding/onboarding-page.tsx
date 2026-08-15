import { type ReactElement, useCallback, useState } from "react";
import { flushSync } from "react-dom";
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
  const changeStage = useCallback((nextStage: OnboardingStage): void => {
    if (!document.startViewTransition) {
      setStage(nextStage);
      return;
    }

    const root = document.documentElement;
    root.classList.add("onboarding-stage-transition");
    const transition = document.startViewTransition(() => {
      flushSync(() => setStage(nextStage));
    });
    void transition.finished.finally(() => {
      root.classList.remove("onboarding-stage-transition");
    });
  }, []);
  const openWorkspaceStage = useCallback((): void => changeStage("workspace"), [changeStage]);
  const runtimeSetup = useOnboardingRuntimeSetup({ onContinue: openWorkspaceStage });
  const workspaceCompletion = useOnboardingWorkspaceCompletion({
    settingsSnapshot: runtimeSetup.settingsSnapshot,
    onComplete,
  });

  return (
    <OnboardingLayout stage={stage}>
      {stage === "welcome" ? <WelcomeStage onContinue={() => changeStage("runtimes")} /> : null}
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
          onBack={() => changeStage("welcome")}
          onContinue={() => void runtimeSetup.saveRuntimes()}
        />
      ) : null}
      {stage === "workspace" ? (
        <WorkspaceStage
          workspaces={workspaceCompletion.workspaces}
          addWorkspace={workspaceCompletion.addFirstWorkspace}
          isFinalizing={workspaceCompletion.isFinalizing}
          onBack={() => changeStage("runtimes")}
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
