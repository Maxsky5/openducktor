import type { PromptView } from "./settings-prompt-owners";
import { RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RuntimeImpactDialog } from "@/components/features/runtimes/runtime-impact-dialog";
import { runtimeImpactPathChanges } from "./settings-save/runtime-settings-application";
import {
  useSettingsModalRequests,
  type SettingsModalOpenRequest,
} from "./use-settings-modal-requests";
import type { RuntimeKind } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { returnFocusOnClose } from "@/components/ui/open-dialogs";
import type { SettingsContentFocusRequest, SettingsDeepLink } from "./settings-deep-link";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import { SettingsModalContent } from "./settings-modal-content";
import { SettingsModalFooter } from "./settings-modal-footer";
import { isSettingsInteractionDisabled } from "./settings-modal-model";
import { INITIAL_NAVIGATION, getOpenState, type Navigation } from "./settings-modal-open-state";
import { SettingsSidebar } from "./settings-modal-sidebars";
import { SettingsModalOpenButton, SettingsModalTrigger } from "./settings-modal-trigger";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";
import { useSettingsModalController } from "./use-settings-modal-controller";

import {
  SettingsDialogHandoffContext,
  SettingsModalContext,
  type SettingsDialogHandoff,
} from "./settings-modal-context";

export { useSettingsModal } from "./settings-modal-context";
export type { SettingsDeepLink } from "./settings-deep-link";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerIconOnly?: boolean;
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerLabel?: string;
  deepLink?: SettingsDeepLink;
  onOpenChange?: (open: boolean) => void;
};

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
          focusReturn={{ kind: "opener", element: activeRequest.trigger }}
          initialNavigation={navigation}
          {...(activeRequest.deepLink ? { deepLink: activeRequest.deepLink } : {})}
          onOpenChange={handleDialogOpenChange}
        />
      ) : null}
    </SettingsModalContext.Provider>
  );
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
    <SettingsDialog
      open={open}
      focusReturn={TRIGGER_FOCUS_RETURN}
      deepLink={deepLink}
      onOpenChange={handleOpenChange}
    >
      <SettingsModalTrigger
        className={triggerClassName}
        iconOnly={triggerIconOnly}
        label={triggerLabel}
        size={triggerSize}
      />
    </SettingsDialog>
  );
}

/**
 * Where Settings returns the focus on close. `trigger`: the Radix trigger of `LocalSettingsModal`
 * gets it, and Settings has no handoff. `opener`: the shared Settings returns it to the element
 * that opened Settings, or gives that element to a dialog that opens in its place. `element` is
 * `null` when no element had the focus.
 */
type SettingsFocusReturn = { kind: "trigger" } | { kind: "opener"; element: HTMLElement | null };

const TRIGGER_FOCUS_RETURN: SettingsFocusReturn = { kind: "trigger" };

type SettingsDialogProps = {
  children?: ReactNode;
  deepLink?: SettingsDeepLink | undefined;
  focusReturn: SettingsFocusReturn;
  initialNavigation?: Navigation;
  onOpenChange: (open: boolean, navigation: Navigation) => void;
  open: boolean;
};

type SettingsDialogHandoffState = {
  handoff: SettingsDialogHandoff | null;
  onCloseAutoFocus: ((event: Event) => void) | undefined;
};

/**
 * The handoff of the shared Settings to a dialog that opens in its place, and the focus return of
 * Settings. The next dialog returns the focus to the opener, so Settings must not move it first.
 */
function useSettingsDialogHandoffState(
  focusReturn: SettingsFocusReturn,
  close: () => void,
): SettingsDialogHandoffState {
  const handedOffRef = useRef(false);
  const hasOpener = focusReturn.kind === "opener";
  const opener = hasOpener ? focusReturn.element : null;
  return useMemo(() => {
    if (!hasOpener) return { handoff: null, onCloseAutoFocus: undefined };
    return {
      handoff: (openDialog) => {
        handedOffRef.current = true;
        openDialog(opener);
        close();
      },
      onCloseAutoFocus: returnFocusOnClose(() => (handedOffRef.current ? null : opener)),
    };
  }, [close, hasOpener, opener]);
}

function SettingsDialog({
  children,
  deepLink,
  initialNavigation = INITIAL_NAVIGATION,
  focusReturn,
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
  const isPreparing = open && controller.isLoadingSettings && controller.snapshotDraft === null;
  const isInteractionDisabled = isSettingsInteractionDisabled(controller);
  const { runtimeReview } = controller;

  const handleSectionChange = (section: SettingsSectionId): void => {
    setNavigation((current) => ({ ...current, section }));
  };

  const handleRepositorySectionChange = (repositorySection: RepositorySectionId): void => {
    setNavigation((current) => ({ ...current, repositorySection }));
  };

  const handleGlobalPromptViewChange = (globalPromptView: PromptView): void => {
    setNavigation((current) => ({ ...current, globalPromptView }));
  };

  const handleRepoPromptViewChange = (repoPromptView: PromptView): void => {
    setNavigation((current) => ({ ...current, repoPromptView }));
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

  const { isSaving, retainDraft } = controller;
  const dismiss = useCallback((): void => {
    if (isSaving) return;
    retainDraft();
    close();
  }, [close, isSaving, retainDraft]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      dismiss();
      return;
    }

    const next = getOpenState(deepLink, navigation);
    setWorkspaceSelectionPolicy(next.workspaceSelectionPolicy);
    setNavigation(next.navigation);
    setFocusRequest(next.focusRequest);
    onOpenChange(true, next.navigation);
  };

  const { handoff, onCloseAutoFocus } = useSettingsDialogHandoffState(focusReturn, dismiss);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children}

      <DialogContent
        loading={isPreparing}
        loadingLabel="Loading settings…"
        // The dialog and its body clip instead of scroll, so `scrollIntoView` moves only the pane
        // of the open section, never the dialog itself.
        className="flex h-[90vh] max-h-[90vh] max-w-7xl flex-col overflow-clip p-0"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6 pr-14">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your agents, workspaces and app preferences.</DialogDescription>
          {controller.settingsError && controller.snapshotDraft ? (
            <p role="alert" className="text-sm text-destructive">
              Settings could not refresh: {controller.settingsError}
              <Button variant="outline" size="sm" onClick={controller.retrySettings}>
                <RefreshCw data-icon="inline-start" />
                Retry settings
              </Button>
            </p>
          ) : null}
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-clip">
          <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1">
            <SettingsSidebar
              section={navigation.section}
              disabled={isInteractionDisabled}
              errorCountById={controller.settingsSectionErrorCountById}
              onChange={handleSectionChange}
            />
            <div className="min-h-0 min-w-0 overflow-y-auto">
              <SettingsDialogHandoffContext.Provider value={handoff}>
                <SettingsModalContent
                  section={navigation.section}
                  repositorySection={navigation.repositorySection}
                  globalPromptView={navigation.globalPromptView}
                  repoPromptView={navigation.repoPromptView}
                  selectedReusablePromptId={navigation.selectedReusablePromptId}
                  selectedCustomAgentRoleId={navigation.selectedCustomAgentRoleId}
                  onSelectedCustomAgentRoleIdChange={(selectedCustomAgentRoleId) =>
                    setNavigation((current) => ({ ...current, selectedCustomAgentRoleId }))
                  }
                  isInteractionDisabled={isInteractionDisabled}
                  controller={controller}
                  onRepositorySectionChange={handleRepositorySectionChange}
                  onGlobalPromptViewChange={handleGlobalPromptViewChange}
                  onRepoPromptViewChange={handleRepoPromptViewChange}
                  onSelectedReusablePromptIdChange={handleSelectedReusablePromptIdChange}
                  contentFocusRequest={focusRequest}
                  onContentFocusRequestHandled={clearFocusRequest}
                />
              </SettingsDialogHandoffContext.Provider>
            </div>
          </div>
        </DialogBody>

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
            promptPlaceholderErrorPlace: controller.promptValidationState.firstErrorPlace,
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
          onCancel={() => {
            controller.discardDraft();
            close();
          }}
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
