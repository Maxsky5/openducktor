import { gitMergeMethodSchema, type GlobalGitConfig } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsSwitchRow } from "./settings-switch-row";

type SettingsGitSectionProps = {
  git: GlobalGitConfig;
  disabled: boolean;
  onUpdateGit: (updater: (current: GlobalGitConfig) => GlobalGitConfig) => void;
};

export function SettingsGitSection({
  git,
  disabled,
  onUpdateGit,
}: SettingsGitSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Git Defaults</h3>
        <p className="text-xs text-muted-foreground">
          Set the default direct-merge behavior and the cleanup that runs when a task closes.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Default merge method</p>
        <Tabs
          value={git.defaultMergeMethod}
          onValueChange={(value) =>
            onUpdateGit((current) => ({
              ...current,
              defaultMergeMethod: gitMergeMethodSchema.parse(value),
            }))
          }
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="merge_commit" disabled={disabled}>
              Merge Commit
            </TabsTrigger>
            <TabsTrigger value="squash" disabled={disabled}>
              Squash
            </TabsTrigger>
            <TabsTrigger value="rebase" disabled={disabled}>
              Rebase
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <SettingsSwitchRow
        title="Remove task worktree on close"
        description="When a task closes, remove its worktree and local task branch."
        checked={git.removeWorktreeOnClose}
        disabled={disabled}
        ariaLabel="Remove task worktree on close"
        onCheckedChange={(removeWorktreeOnClose) =>
          onUpdateGit((current) => ({ ...current, removeWorktreeOnClose }))
        }
      />
    </div>
  );
}
