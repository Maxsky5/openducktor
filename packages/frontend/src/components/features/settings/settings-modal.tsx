import { Settings2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  PromptRoleTabId,
  RepositorySectionId,
  SettingsSectionId,
} from "./settings-modal-constants";
import { SettingsModalContent } from "./settings-modal-content";
import { SettingsModalFooter } from "./settings-modal-footer";
import { SettingsSidebar } from "./settings-modal-sidebars";
import { useSettingsModalController } from "./use-settings-modal-controller";

type SettingsModalProps = {
  triggerClassName?: string;
  triggerSize?: "default" | "sm" | "lg" | "icon";
};

type SettingsModalNavigationState = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
};

const INITIAL_SECTION: SettingsSectionId = "repositories";
const INITIAL_REPOSITORY_SECTION: RepositorySectionId = "configuration";
const INITIAL_PROMPT_ROLE_TAB: PromptRoleTabId = "shared";
const INITIAL_NAVIGATION_STATE: SettingsModalNavigationState = {
  section: INITIAL_SECTION,
  repositorySection: INITIAL_REPOSITORY_SECTION,
  globalPromptRoleTab: INITIAL_PROMPT_ROLE_TAB,
  repoPromptRoleTab: INITIAL_PROMPT_ROLE_TAB,
};

export function SettingsModal({
  triggerClassName,
  triggerSize = "sm",
}: SettingsModalProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [navigation, setNavigation] =
    useState<SettingsModalNavigationState>(INITIAL_NAVIGATION_STATE);
  const controller = useSettingsModalController({
    open,
    shouldLoadCatalog:
      open && navigation.section === "repositories" && navigation.repositorySection === "agents",
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

  const handleSave = (): void => {
    controller.markRepoScriptSaveAttempt();
    void controller.submit().then((saved) => {
      if (saved) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && controller.isSaving) {
          return;
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={triggerSize} className={cn(triggerClassName)}>
          <Settings2 className="size-4" />
          Settings
        </Button>
      </DialogTrigger>

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
                isInteractionDisabled={isInteractionDisabled}
                controller={controller}
                onRepositorySectionChange={handleRepositorySectionChange}
                onGlobalPromptRoleTabChange={handleGlobalPromptRoleTabChange}
                onRepoPromptRoleTabChange={handleRepoPromptRoleTabChange}
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
            customPromptFieldErrorCount: controller.customPromptValidationState.totalErrorCount,
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
          onCancel={() => setOpen(false)}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
