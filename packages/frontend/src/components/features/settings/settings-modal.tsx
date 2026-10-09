import { Save } from "lucide-react";
import { RuntimeImpactDialog } from "@/components/features/runtimes/runtime-impact-dialog";
import { runtimeImpactPathChanges } from "./settings-save/runtime-settings-application";
import {
  useSettingsModalRequests,
  type SettingsModalOpenRequest,
} from "./use-settings-modal-requests";
import type { RuntimeKind } from "@openducktor/contracts";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SettingsContentFocusRequest, SettingsDeepLink } from "./settings-deep-link";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { SettingsModalContent } from "./settings-modal-content";
import { SettingsModalFooter } from "./settings-modal-footer";
import { isSettingsInteractionDisabled } from "./settings-modal-model";
import { INITIAL_NAVIGATION, getOpenState, type Navigation } from "./settings-modal-open-state";
import { SettingsSidebar } from "./settings-modal-sidebars";
import { SettingsModalOpenButton, SettingsModalTrigger } from "./settings-modal-trigger";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";
import { useSettingsModalController } from "./use-settings-modal-controller";

export type { SettingsDeepLink } from "./settings-deep-link";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerIconOnly?: boolean;
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerLabel?: string;
  deepLink?: SettingsDeepLink;
  onOpenChange?: (open: boolean) => void;
};

type SettingsModalContextValue = {
  openSettings(request?: SettingsModalOpenRequest): void;
};

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

export function SettingsModal(props: SettingsModalProps): ReactElement {
  const context = useContext(SettingsModalContext);
  if (!context) return <LocalSettingsModal {...props} />;

  const request: SettingsModalOpenRequest = {};
  if (props.deepLink) request.deepLink = props.deepLink;
  if (props.onOpenChange) request.onOpenChange = props.onOpenChange;

  return (
    <SettingsModalOpenButton
      className={props.triggerClassName}
      iconOnly={props.triggerIconOnly ?? false}
      label={props.triggerLabel ?? "Settings"}
      size={props.triggerSize ?? (props.triggerIconOnly ? "icon" : "sm")}
      onClick={() => context.openSettings(request)}
    />
  );
}

export function SettingsModalProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRequest, openSettings, handleOpenChange } = useSettingsModalRequests();
  const [navigation, setNavigation] = useState(INITIAL_NAVIGATION);
  const handleDialogOpenChange = useCallback(
    (open: boolean, next: Navigation): void => {
      if (!open) setNavigation(next);
      handleOpenChange(open);
    },
    [handleOpenChange],
  );

  const contextValue = useMemo(() => ({ openSettings }), [openSettings]);

  return (
    <SettingsModalContext.Provider value={contextValue}>
      {children}
      {activeRequest ? (
        <SettingsDialog
          key={activeRequest.id}
          open
          initialNavigation={navigation}
          {...(activeRequest.deepLink ? { deepLink: activeRequest.deepLink } : {})}
          onOpenChange={handleDialogOpenChange}
        />
      ) : null}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal(): SettingsModalContextValue {
  const value = useContext(SettingsModalContext);
  if (!value) throw new Error("useSettingsModal must be used inside SettingsModalProvider.");
  return value;
}

function LocalSettingsModal({
  triggerClassName,
  triggerIconOnly = false,
  triggerSize = triggerIconOnly ? "icon" : "sm",
  triggerLabel = "Settings",
  deepLink,
  onOpenChange,
}: SettingsModalProps): ReactElement {
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <SettingsDialog open={open} deepLink={deepLink} onOpenChange={handleOpenChange}>
      <SettingsModalTrigger
        className={triggerClassName}
        iconOnly={triggerIconOnly}
        label={triggerLabel}
        size={triggerSize}
      />
    </SettingsDialog>
  );
}

type SettingsDialogProps = {
  children?: ReactNode;
  deepLink?: SettingsDeepLink | undefined;
  initialNavigation?: Navigation;
  onOpenChange: (open: boolean, navigation: Navigation) => void;
  open: boolean;
};

function SettingsDialog({
  children,
  deepLink,
  initialNavigation = INITIAL_NAVIGATION,
  onOpenChange,
  open,
}: SettingsDialogProps): ReactElement {
  const initial = getOpenState(deepLink, initialNavigation);
  const [workspaceSelectionPolicy, setWorkspaceSelectionPolicy] = useState<
    SettingsWorkspaceSelectionPolicy | undefined
  >(initial.workspaceSelectionPolicy);
  const [focusRequest, setFocusRequest] = useState<SettingsContentFocusRequest | null>(
    initial.focusRequest,
  );
  const [navigation, setNavigation] = useState<Navigation>(initial.navigation);
  const handleRuntimeAvailabilityError = useCallback((runtimeKind: RuntimeKind): void => {
    setNavigation((current) => ({ ...current, section: "runtimes" }));
    setFocusRequest({ kind: "runtime-executable", runtimeKind });
  }, []);
  const controller = useSettingsModalController({
    open,
    shouldLoadCatalog:
      open && navigation.section === "repositories" && navigation.repositorySection === "agents",
    workspaceSelectionPolicy,
    onRuntimeAvailabilityError: handleRuntimeAvailabilityError,
  });
  const isInteractionDisabled = isSettingsInteractionDisabled(controller);
  const { runtimeReview } = controller;

  const handleSectionChange = (section: SettingsSectionId): void => {
    setNavigation((current) => ({ ...current, section }));
  };

  const handleRepositorySectionChange = (repositorySection: RepositorySectionId): void => {
    setNavigation((current) => ({ ...current, repositorySection }));
  };

  const handleGlobalPromptRoleTabChange = (globalPromptRoleTab: PromptRoleTabId): void => {
    setNavigation((current) => ({ ...current, globalPromptRoleTab }));
  };

  const handleRepoPromptRoleTabChange = (repoPromptRoleTab: PromptRoleTabId): void => {
    setNavigation((current) => ({ ...current, repoPromptRoleTab }));
  };

  const handleSelectedReusablePromptIdChange = (selectedReusablePromptId: string | null): void => {
    setNavigation((current) => ({ ...current, selectedReusablePromptId }));
  };

  const clearFocusRequest = useCallback((request: SettingsContentFocusRequest): void => {
    setFocusRequest((current) => (current === request ? null : current));
  }, []);

  const close = useCallback((): void => {
    setWorkspaceSelectionPolicy(undefined);
    setFocusRequest(null);
    onOpenChange(false, navigation);
  }, [navigation, onOpenChange]);

  const handleSave = (): void => {
    void controller.submit().then((saved) => {
      if (saved) {
        close();
      }
    });
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      if (!controller.isSaving) {
        close();
      }
      return;
    }

    const next = getOpenState(deepLink, navigation);
    setWorkspaceSelectionPolicy(next.workspaceSelectionPolicy);
    setNavigation(next.navigation);
    setFocusRequest(next.focusRequest);
    onOpenChange(true, next.navigation);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children}

      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-7xl flex-col p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure global defaults, repository settings, and prompt overrides.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] grid-rows-1">
            <SettingsSidebar
              section={navigation.section}
              disabled={isInteractionDisabled}
              errorCountById={controller.settingsSectionErrorCountById}
              onChange={handleSectionChange}
            />
            <div className="min-h-0 overflow-y-auto">
              <SettingsModalContent
                section={navigation.section}
                repositorySection={navigation.repositorySection}
                globalPromptRoleTab={navigation.globalPromptRoleTab}
                repoPromptRoleTab={navigation.repoPromptRoleTab}
                selectedReusablePromptId={navigation.selectedReusablePromptId}
                selectedCustomAgentRoleId={navigation.selectedCustomAgentRoleId}
                onSelectedCustomAgentRoleIdChange={(selectedCustomAgentRoleId) =>
                  setNavigation((current) => ({ ...current, selectedCustomAgentRoleId }))
                }
                isInteractionDisabled={isInteractionDisabled}
                controller={controller}
                onRepositorySectionChange={handleRepositorySectionChange}
                onGlobalPromptRoleTabChange={handleGlobalPromptRoleTabChange}
                onRepoPromptRoleTabChange={handleRepoPromptRoleTabChange}
                onSelectedReusablePromptIdChange={handleSelectedReusablePromptIdChange}
                contentFocusRequest={focusRequest}
                onContentFocusRequestHandled={clearFocusRequest}
              />
            </div>
          </div>
        </div>

        <SettingsModalFooter
          saveState={{
            isSaving: controller.isSaving,
            isLoadingSettings: controller.isLoadingSettings,
            hasSnapshotDraft: Boolean(controller.snapshotDraft),
            settingsError: controller.settingsError,
            isLoadingRuntimeConfiguration:
              controller.isLoadingRuntimeDefinitions || controller.isLoadingRuntimeExecutables,
          }}
          validationSummary={{
            openCodePermissionErrorCount: controller.openCodePermissionErrorCount,
            customAgentRoleFieldErrorCount:
              controller.customAgentRoleValidationState.totalErrorCount,
            promptPlaceholderErrorCount: controller.promptValidationState.totalErrorCount,
            reusablePromptFieldErrorCount: controller.reusablePromptValidationState.totalErrorCount,
            runtimeAvailabilityErrorCount:
              controller.runtimeAvailabilityValidationState.totalErrorCount,
            claudeSettingsError: controller.claudeSettingsSaveError,
            hasUnacknowledgedCodexDangerousSettings:
              controller.hasUnacknowledgedCodexDangerousSettings,
          }}
          errors={{
            saveError: controller.saveError,
            catalogError: controller.runtimeDefinitionsError,
            runtimeExecutablesError: controller.runtimeExecutablesError,
          }}
          location={{
            section: navigation.section,
            repositorySection: navigation.repositorySection,
          }}
          onCancel={close}
          onSave={handleSave}
        />
      </DialogContent>
      <RuntimeImpactDialog
        open={runtimeReview !== null}
        title="Apply runtime changes"
        description="Saving these settings stops or replaces agent runtimes."
        confirmLabel="Save and apply"
        confirmIcon={Save}
        impact={runtimeReview?.impact ?? null}
        isLoadingImpact={runtimeReview?.isLoadingImpact ?? false}
        impactError={runtimeReview?.impactError ?? null}
        notice={runtimeReview?.notice ?? null}
        pathChanges={runtimeReview?.impact ? runtimeImpactPathChanges(runtimeReview.impact) : []}
        isPending={runtimeReview?.isPending ?? false}
        error={null}
        onConfirm={controller.confirmRuntimeReview}
        onCancel={controller.cancelRuntimeReview}
      />
    </Dialog>
  );
}
