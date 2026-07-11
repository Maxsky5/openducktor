import { type ReactElement, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  resolveSettingsDeepLink,
  type SettingsContentFocusRequest,
  type SettingsDeepLink,
  type SettingsDeepLinkResolution,
} from "./settings-deep-link";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { SettingsModalContent } from "./settings-modal-content";
import { SettingsModalFooter } from "./settings-modal-footer";
import { SettingsSidebar } from "./settings-modal-sidebars";
import { SettingsModalTrigger } from "./settings-modal-trigger";
import { useSettingsModalController } from "./use-settings-modal-controller";

export type { SettingsDeepLink } from "./settings-deep-link";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerIconOnly?: boolean;
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerLabel?: string;
  deepLink?: SettingsDeepLink;
};

type SettingsModalNavigationState = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
  selectedReusablePromptId: string | null;
};

const INITIAL_SECTION: SettingsSectionId = "repositories";
const INITIAL_REPOSITORY_SECTION: RepositorySectionId = "configuration";
const INITIAL_PROMPT_ROLE_TAB: PromptRoleTabId = "shared";
const INITIAL_NAVIGATION_STATE: SettingsModalNavigationState = {
  section: INITIAL_SECTION,
  repositorySection: INITIAL_REPOSITORY_SECTION,
  globalPromptRoleTab: INITIAL_PROMPT_ROLE_TAB,
  repoPromptRoleTab: INITIAL_PROMPT_ROLE_TAB,
  selectedReusablePromptId: null,
};

export function SettingsModal({
  triggerClassName,
  triggerIconOnly = false,
  triggerSize = triggerIconOnly ? "icon" : "sm",
  triggerLabel = "Settings",
  deepLink,
}: SettingsModalProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeDeepLinkResolution, setActiveDeepLinkResolution] =
    useState<SettingsDeepLinkResolution | null>(null);
  const [contentFocusRequest, setContentFocusRequest] =
    useState<SettingsContentFocusRequest | null>(null);
  const [navigation, setNavigation] =
    useState<SettingsModalNavigationState>(INITIAL_NAVIGATION_STATE);
  const controller = useSettingsModalController({
    open,
    shouldLoadCatalog:
      open && navigation.section === "repositories" && navigation.repositorySection === "agents",
    workspaceSelectionPolicy: activeDeepLinkResolution?.workspaceSelectionPolicy,
  });
  const isInteractionDisabled = controller.isLoadingSettings || controller.isSaving;

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
    setOpen(false);
    setActiveDeepLinkResolution(null);
    setContentFocusRequest(null);
  }, []);

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

    const nextDeepLinkResolution = deepLink ? resolveSettingsDeepLink(deepLink) : null;
    setActiveDeepLinkResolution(nextDeepLinkResolution);
    if (nextDeepLinkResolution) {
      setNavigation((current) => ({ ...current, ...nextDeepLinkResolution.navigation }));
      setContentFocusRequest(nextDeepLinkResolution.contentFocus);
    }
    setOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <SettingsModalTrigger
        className={triggerClassName}
        iconOnly={triggerIconOnly}
        label={triggerLabel}
        size={triggerSize}
      />

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
