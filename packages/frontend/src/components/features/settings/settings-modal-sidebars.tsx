import type { WorkspaceRecord } from "@openducktor/contracts";
import { CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { RepositorySelector } from "@/components/features/repository/repository-selector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import { REPOSITORY_SECTIONS, SETTINGS_SECTIONS } from "./settings-modal-constants";

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
    <aside className="border-r border-border bg-muted/50 p-3">
      <div className="space-y-1">
        {SETTINGS_SECTIONS.map((entry) => {
          const Icon = entry.icon;
          const sectionErrorCount = errorCountById[entry.id] ?? 0;
          return (
            <Button
              key={entry.id}
              type="button"
              variant={section === entry.id ? "accent" : "ghost"}
              className="w-full justify-between"
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
  selectedRepoScriptValidationErrorCount: number;
  repoPromptErrorCountByWorkspaceId: Record<string, number>;
  repoScriptErrorCountByWorkspaceId: Record<string, number>;
  onSelectWorkspaceId: (next: string) => void;
  onSelectSection: (next: RepositorySectionId) => void;
};

export function RepositorySidebar({
  workspaces,
  selectedWorkspaceId,
  selectedRepositorySection,
  disabled,
  selectedRepoPromptValidationErrorCount,
  selectedRepoScriptValidationErrorCount,
  repoPromptErrorCountByWorkspaceId,
  repoScriptErrorCountByWorkspaceId,
  onSelectWorkspaceId,
  onSelectSection,
}: RepositorySidebarProps): ReactElement {
  const repoErrorCountByWorkspaceId: Record<string, number> = {};
  for (const workspace of workspaces) {
    const errorCount =
      (repoPromptErrorCountByWorkspaceId[workspace.workspaceId] ?? 0) +
      (repoScriptErrorCountByWorkspaceId[workspace.workspaceId] ?? 0);
    if (errorCount > 0) {
      repoErrorCountByWorkspaceId[workspace.workspaceId] = errorCount;
    }
  }
  const sectionErrorCountById: Partial<Record<RepositorySectionId, number>> = {
    prompts: selectedRepoPromptValidationErrorCount,
    scripts: selectedRepoScriptValidationErrorCount,
  };

  return (
    <aside className="space-y-3 border-r border-border bg-muted p-3">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Repository</Label>
        <RepositorySelector
          workspaces={workspaces}
          value={selectedWorkspaceId ?? ""}
          placeholder={workspaces.length > 0 ? "Select repository" : "No repository configured"}
          searchPlaceholder="Search repository..."
          disabled={disabled || workspaces.length === 0}
          errorCountByWorkspaceId={repoErrorCountByWorkspaceId}
          onValueChange={onSelectWorkspaceId}
        />
      </div>

      <div className="space-y-1">
        {REPOSITORY_SECTIONS.map((entry) => {
          const sectionErrorCount = sectionErrorCountById[entry.id] ?? 0;
          return (
            <Button
              key={entry.id}
              type="button"
              variant={selectedRepositorySection === entry.id ? "accent" : "ghost"}
              className="w-full justify-between"
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
