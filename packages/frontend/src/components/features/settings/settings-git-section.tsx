import { gitMergeMethodSchema, type GlobalGitConfig } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          Set the default direct-merge behavior used by the human approval flow.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Default merge method</p>
        <Tabs
          value={git.defaultMergeMethod}
          onValueChange={(value) =>
            onUpdateGit(() => ({
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
    </div>
  );
}
