import type { GitBranch } from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  segmentedControlRootClassName,
  segmentedControlTriggerClassName,
} from "@/components/ui/segmented-control-classnames";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  ExistingWorktreeBranchFields,
  NewWorktreeBranchFields,
  WorktreeNameField,
  type WorktreeInputProps,
} from "./workspace-session-worktree-inputs";

type Props = WorktreeInputProps & {
  workspace: ActiveWorkspace;
  branches: UseQueryResult<GitBranch[]>;
};

const worktreeTabClassName = segmentedControlTriggerClassName({
  size: "md",
  className:
    "border-none data-[state=active]:border-transparent data-[state=inactive]:text-foreground/70 dark:data-[state=inactive]:text-foreground/80",
});

export function WorkspaceSessionWorktreeFields({
  workspace,
  value,
  onChange,
  disabled,
  error,
  branches,
}: Props): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <Tabs
        value={value.mode}
        onValueChange={(mode) => {
          if (mode === "from_branch") onChange({ mode, name: value.name, branchName: "" });
          if (mode === "from_name") onChange({ mode, name: value.name, branchName: null });
        }}
      >
        <TabsList
          aria-label="Worktree creation mode"
          className={segmentedControlRootClassName({ size: "md", className: "w-full" })}
        >
          <TabsTrigger value="from_branch" disabled={disabled} className={worktreeTabClassName}>
            Existing branch
          </TabsTrigger>
          <TabsTrigger value="from_name" disabled={disabled} className={worktreeTabClassName}>
            New branch
          </TabsTrigger>
        </TabsList>
        <TabsContent value="from_branch" className="pt-2">
          <ExistingWorktreeBranchFields
            value={value}
            onChange={onChange}
            disabled={disabled}
            error={error}
            branches={branches}
          />
        </TabsContent>
        <TabsContent value="from_name" className="pt-2">
          <p className="text-xs text-muted-foreground">
            Creates a new branch from the target branch.
          </p>
        </TabsContent>
      </Tabs>
      <WorktreeNameField value={value} onChange={onChange} disabled={disabled} error={error} />
      <NewWorktreeBranchFields
        workspace={workspace}
        value={value}
        onChange={onChange}
        disabled={disabled}
        error={error}
      />
    </div>
  );
}
