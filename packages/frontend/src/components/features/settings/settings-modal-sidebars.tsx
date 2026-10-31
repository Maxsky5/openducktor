import type { WorkspaceRecord } from "@openducktor/contracts";
import { CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { RepositorySelector } from "@/components/features/repository/repository-selector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import { REPOSITORY_SECTIONS, SETTINGS_SECTIONS } from "./settings-modal-constants";
import { getShellBridge } from "@/lib/shell-bridge";

type SettingsSidebarProps = {
  section: SettingsSectionId;
  disabled: boolean;
  errorCountById: Partial<Record<SettingsSectionId, number>>;
  onChange: (next: SettingsSectionId) => void;
};

export function SettingsSidebar({
  section,
  disabled,
  errorCountById,
  onChange,
}: SettingsSidebarProps): ReactElement {
  return (
    <aside className="min-h-0 border-b border-border bg-muted/50 p-2 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3">
      <div className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {SETTINGS_SECTIONS.map((entry) => {
          if (entry.id === "remote-access" && !getShellBridge().remoteAccess) return null;
          const Icon = entry.icon;
          const sectionErrorCount = errorCountById[entry.id] ?? 0;
          return (
            <Button
              key={entry.id}
              type="button"
              variant={section === entry.id ? "accent" : "ghost"}
              className="shrink-0 justify-between sm:w-full"
              disabled={disabled}
              onClick={() => onChange(entry.id)}
              title={
                sectionErrorCount > 0
                  ? `${sectionErrorCount} settings error${sectionErrorCount > 1 ? "s" : ""}`
                  : undefined
              }
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Icon className="size-4" />
                <span className="truncate">{entry.label}</span>
              </span>
              {sectionErrorCount > 0 ? (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive-muted">
                  <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

type RepositorySidebarProps = {
  workspaces: WorkspaceRecord[];
  selectedWorkspaceId: string | null;
  selectedRepositorySection: RepositorySectionId;
  disabled: boolean;
  selectedRepoPromptValidationErrorCount: number;
  repoPromptErrorCountByWorkspaceId: Record<string, number>;
  onSelectWorkspaceId: (next: string) => void;
  onSelectSection: (next: RepositorySectionId) => void;
};

export function RepositorySidebar({
  workspaces,
  selectedWorkspaceId,
  selectedRepositorySection,
  disabled,
  selectedRepoPromptValidationErrorCount,
  repoPromptErrorCountByWorkspaceId,
  onSelectWorkspaceId,
  onSelectSection,
}: RepositorySidebarProps): ReactElement {
  const repoErrorCountByWorkspaceId: Record<string, number> = {};
  for (const workspace of workspaces) {
    const errorCount = repoPromptErrorCountByWorkspaceId[workspace.workspaceId] ?? 0;
    if (errorCount > 0) {
      repoErrorCountByWorkspaceId[workspace.workspaceId] = errorCount;
    }
  }
  const sectionErrorCountById = new Map<RepositorySectionId, number>([
    ["prompts", selectedRepoPromptValidationErrorCount],
  ]);

  return (
    <aside className="flex min-h-0 flex-col gap-3 border-b border-border bg-muted p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Repository</Label>
        <RepositorySelector
          workspaces={workspaces}
          value={selectedWorkspaceId ?? ""}
          placeholder={workspaces.length > 0 ? "Select repository" : "No repository configured"}
          searchPlaceholder="Search repositories…"
          disabled={disabled || workspaces.length === 0}
          errorCountByWorkspaceId={repoErrorCountByWorkspaceId}
          onValueChange={onSelectWorkspaceId}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {REPOSITORY_SECTIONS.map((entry) => {
          const sectionErrorCount = sectionErrorCountById.get(entry.id) ?? 0;
          return (
            <Button
              key={entry.id}
              type="button"
              variant={selectedRepositorySection === entry.id ? "accent" : "ghost"}
              className="shrink-0 justify-between lg:w-full"
              disabled={disabled}
              onClick={() => onSelectSection(entry.id)}
              title={
                sectionErrorCount > 0
                  ? `${sectionErrorCount} error${sectionErrorCount > 1 ? "s" : ""} in ${entry.label}`
                  : undefined
              }
            >
              <span>{entry.label}</span>
              {sectionErrorCount > 0 ? (
                <CircleAlert
                  className="size-3.5 shrink-0 text-destructive-muted"
                  aria-hidden="true"
                />
              ) : null}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
