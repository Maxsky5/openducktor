import { Settings2 } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
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

export function SettingsModal({
  triggerClassName,
  triggerSize = "sm",
}: SettingsModalProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("repositories");
  const [repositorySection, setRepositorySection] = useState<RepositorySectionId>("configuration");
  const [globalPromptRoleTab, setGlobalPromptRoleTab] = useState<PromptRoleTabId>("shared");
  const [repoPromptRoleTab, setRepoPromptRoleTab] = useState<PromptRoleTabId>("shared");

  const controller = useSettingsModalController(open);
  const isInteractionDisabled = controller.isLoadingSettings || controller.isSaving;

  const handleSave = (): void => {
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
              section={section}
              disabled={isInteractionDisabled}
              errorCountById={controller.settingsSectionErrorCountById}
              onChange={setSection}
            />
            <div className="min-h-0 overflow-y-auto">
              <SettingsModalContent
                section={section}
                repositorySection={repositorySection}
                globalPromptRoleTab={globalPromptRoleTab}
                repoPromptRoleTab={repoPromptRoleTab}
                isInteractionDisabled={isInteractionDisabled}
                controller={controller}
                onRepositorySectionChange={setRepositorySection}
                onGlobalPromptRoleTabChange={setGlobalPromptRoleTab}
                onRepoPromptRoleTabChange={setRepoPromptRoleTab}
              />
            </div>
          </div>
        </div>

        <SettingsModalFooter
          isSaving={controller.isSaving}
          isLoadingSettings={controller.isLoadingSettings}
          hasPromptValidationErrors={controller.hasPromptValidationErrors}
          settingsError={controller.settingsError}
          saveError={controller.saveError}
          catalogError={controller.runtimeDefinitionsError}
          section={section}
          repositorySection={repositorySection}
          promptValidationState={controller.promptValidationState}
          hasSnapshotDraft={Boolean(controller.snapshotDraft)}
          onCancel={() => setOpen(false)}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
