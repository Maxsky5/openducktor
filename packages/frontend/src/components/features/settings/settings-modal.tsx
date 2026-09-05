import type { RuntimeKind } from "@openducktor/contracts";
import {
  createContext,
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
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  SettingsContentFocusRequest,
  SettingsDeepLink,
  SettingsDeepLinkResolution,
} from "./settings-deep-link";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { SettingsModalContent } from "./settings-modal-content";
import { SettingsModalFooter } from "./settings-modal-footer";
import { isSettingsInteractionDisabled } from "./settings-modal-model";
import {
  resolveSettingsModalOpenState,
  type SettingsModalNavigationState,
} from "./settings-modal-open-state";
import { SettingsSidebar } from "./settings-modal-sidebars";
import { SettingsModalOpenButton, SettingsModalTrigger } from "./settings-modal-trigger";
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

type SettingsModalDialogProps = {
  children?: ReactNode;
  deepLink?: SettingsDeepLink | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function SettingsModalDialog({
  children,
  deepLink,
  onOpenChange,
  open,
}: SettingsModalDialogProps): ReactElement {
  const initialOpenState = resolveSettingsModalOpenState(deepLink);
  const [activeDeepLinkResolution, setActiveDeepLinkResolution] =
    useState<SettingsDeepLinkResolution | null>(initialOpenState.deepLinkResolution);
  const [contentFocusRequest, setContentFocusRequest] =
    useState<SettingsContentFocusRequest | null>(initialOpenState.contentFocusRequest);
  const [navigation, setNavigation] = useState<SettingsModalNavigationState>(
    initialOpenState.navigation,
  );
  const handleRuntimeAvailabilityError = useCallback((runtimeKind: RuntimeKind): void => {
    setNavigation((current) => ({ ...current, section: "runtimes" }));
    setContentFocusRequest({ kind: "runtime-executable", runtimeKind });
  }, []);
  const workspaceSelectionPolicy =
    activeDeepLinkResolution?.scope === "repository"
      ? activeDeepLinkResolution.workspaceSelectionPolicy
      : undefined;
  const controller = useSettingsModalController({
    open,
    shouldLoadCatalog:
      open && navigation.section === "repositories" && navigation.repositorySection === "agents",
    workspaceSelectionPolicy,
    onRuntimeAvailabilityError: handleRuntimeAvailabilityError,
  });
  const isInteractionDisabled = isSettingsInteractionDisabled(controller);

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

  const handleContentFocusRequestHandled = useCallback(
    (handledRequest: SettingsContentFocusRequest): void => {
      setContentFocusRequest((current) => (current === handledRequest ? null : current));
    },
    [],
  );

  const closeModal = useCallback((): void => {
    setActiveDeepLinkResolution(null);
    setContentFocusRequest(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSave = (): void => {
    controller.markRepoScriptSaveAttempt();
    void controller.submit().then((saved) => {
      if (saved) {
        closeModal();
      }
    });
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      if (!controller.isSaving) {
        closeModal();
      }
      return;
    }

    const nextOpenState = resolveSettingsModalOpenState(deepLink);
    setActiveDeepLinkResolution(nextOpenState.deepLinkResolution);
    setNavigation(nextOpenState.navigation);
    setContentFocusRequest(nextOpenState.contentFocusRequest);
    onOpenChange(true);
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
          <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)]">
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
                isInteractionDisabled={isInteractionDisabled}
                controller={controller}
                onRepositorySectionChange={handleRepositorySectionChange}
                onGlobalPromptRoleTabChange={handleGlobalPromptRoleTabChange}
                onRepoPromptRoleTabChange={handleRepoPromptRoleTabChange}
                onSelectedReusablePromptIdChange={handleSelectedReusablePromptIdChange}
                contentFocusRequest={contentFocusRequest}
                onContentFocusRequestHandled={handleContentFocusRequestHandled}
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
            promptPlaceholderErrorCount: controller.promptValidationState.totalErrorCount,
            reusablePromptFieldErrorCount: controller.reusablePromptValidationState.totalErrorCount,
            runtimeAvailabilityErrorCount:
              controller.runtimeAvailabilityValidationState.totalErrorCount,
            hasUnacknowledgedCodexDangerousSettings:
              controller.hasUnacknowledgedCodexDangerousSettings,
            repoScriptFieldErrorCount: controller.repoScriptValidationErrorCount,
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
          onCancel={closeModal}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
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
    <SettingsModalDialog open={open} deepLink={deepLink} onOpenChange={handleOpenChange}>
      <SettingsModalTrigger
        className={triggerClassName}
        iconOnly={triggerIconOnly}
        label={triggerLabel}
        size={triggerSize}
      />
    </SettingsModalDialog>
  );
}

type SettingsModalOpenRequest = {
  deepLink?: SettingsDeepLink;
  onOpenChange?: (open: boolean) => void;
};

type SettingsModalContextValue = {
  openSettings(request?: SettingsModalOpenRequest): void;
};

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

type ActiveSettingsRequest = SettingsModalOpenRequest & { id: number };

export function SettingsModalProvider({ children }: PropsWithChildren): ReactElement {
  const [activeRequest, setActiveRequest] = useState<ActiveSettingsRequest | null>(null);
  const requestIdRef = useRef(0);

  const openSettings = useCallback((request: SettingsModalOpenRequest = {}): void => {
    requestIdRef.current += 1;
    request.onOpenChange?.(true);
    setActiveRequest({ ...request, id: requestIdRef.current });
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (open) return;
      activeRequest?.onOpenChange?.(false);
      setActiveRequest(null);
    },
    [activeRequest],
  );

  const contextValue = useMemo(() => ({ openSettings }), [openSettings]);

  return (
    <SettingsModalContext.Provider value={contextValue}>
      {children}
      {activeRequest ? (
        <SettingsModalDialog
          key={activeRequest.id}
          open
          {...(activeRequest.deepLink ? { deepLink: activeRequest.deepLink } : {})}
          onOpenChange={handleOpenChange}
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
