import { Settings2 } from "lucide-react";
import type { ReactElement } from "react";
import { useReducer } from "react";
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

type SettingsModalState = {
  open: boolean;
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  globalPromptRoleTab: PromptRoleTabId;
  repoPromptRoleTab: PromptRoleTabId;
};

type SettingsModalAction =
  | { type: "set_open"; open: boolean }
  | { type: "set_section"; section: SettingsSectionId }
  | { type: "set_repository_section"; repositorySection: RepositorySectionId }
  | { type: "set_global_prompt_role_tab"; globalPromptRoleTab: PromptRoleTabId }
  | { type: "set_repo_prompt_role_tab"; repoPromptRoleTab: PromptRoleTabId };

const INITIAL_SETTINGS_MODAL_STATE: SettingsModalState = {
  open: false,
  section: "repositories",
  repositorySection: "configuration",
  globalPromptRoleTab: "shared",
  repoPromptRoleTab: "shared",
};

const settingsModalReducer = (
  state: SettingsModalState,
  action: SettingsModalAction,
): SettingsModalState => {
  switch (action.type) {
    case "set_open":
      return {
        ...state,
        open: action.open,
      };
    case "set_section":
      return {
        ...state,
        section: action.section,
      };
    case "set_repository_section":
      return {
        ...state,
        repositorySection: action.repositorySection,
      };
    case "set_global_prompt_role_tab":
      return {
        ...state,
        globalPromptRoleTab: action.globalPromptRoleTab,
      };
    case "set_repo_prompt_role_tab":
      return {
        ...state,
        repoPromptRoleTab: action.repoPromptRoleTab,
      };
  }
};

export function SettingsModal({
  triggerClassName,
  triggerSize = "sm",
}: SettingsModalProps): ReactElement {
  const [state, dispatch] = useReducer(settingsModalReducer, INITIAL_SETTINGS_MODAL_STATE);
  const { globalPromptRoleTab, open, repoPromptRoleTab, repositorySection, section } = state;
  const controller = useSettingsModalController({
    open,
    shouldLoadCatalog: open && section === "repositories" && repositorySection === "agents",
  });
  const isInteractionDisabled = controller.isLoadingSettings || controller.isSaving;

  const handleSave = (): void => {
    controller.markRepoScriptSaveAttempt();
    void controller.submit().then((saved) => {
      if (saved) {
        dispatch({ type: "set_open", open: false });
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
        dispatch({ type: "set_open", open: nextOpen });
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
              section={section}
              disabled={isInteractionDisabled}
              errorCountById={controller.settingsSectionErrorCountById}
              onChange={(nextSection) => dispatch({ type: "set_section", section: nextSection })}
            />
            <div className="min-h-0 overflow-y-auto">
              <SettingsModalContent
                section={section}
                repositorySection={repositorySection}
                globalPromptRoleTab={globalPromptRoleTab}
                repoPromptRoleTab={repoPromptRoleTab}
                isInteractionDisabled={isInteractionDisabled}
                controller={controller}
                onRepositorySectionChange={(nextRepositorySection) =>
                  dispatch({
                    type: "set_repository_section",
                    repositorySection: nextRepositorySection,
                  })
                }
                onGlobalPromptRoleTabChange={(nextGlobalPromptRoleTab) =>
                  dispatch({
                    type: "set_global_prompt_role_tab",
                    globalPromptRoleTab: nextGlobalPromptRoleTab,
                  })
                }
                onRepoPromptRoleTabChange={(nextRepoPromptRoleTab) =>
                  dispatch({
                    type: "set_repo_prompt_role_tab",
                    repoPromptRoleTab: nextRepoPromptRoleTab,
                  })
                }
              />
            </div>
          </div>
        </div>

        <SettingsModalFooter
          isSaving={controller.isSaving}
          isLoadingSettings={controller.isLoadingSettings}
          hasPromptValidationErrors={controller.hasPromptValidationErrors}
          hasRepoScriptValidationErrors={controller.hasRepoScriptValidationErrors}
          settingsError={controller.settingsError}
          saveError={controller.saveError}
          catalogError={controller.runtimeDefinitionsError}
          section={section}
          repositorySection={repositorySection}
          promptValidationState={controller.promptValidationState}
          repoScriptValidationErrorCount={controller.repoScriptValidationErrorCount}
          hasSnapshotDraft={Boolean(controller.snapshotDraft)}
          onCancel={() => dispatch({ type: "set_open", open: false })}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
