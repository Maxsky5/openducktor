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
  errorCountById: Record<SettingsSectionId, number>;
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
          const sectionErrorCount = errorCountById[entry.id];
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
                  ? `${sectionErrorCount} prompt placeholder error${sectionErrorCount > 1 ? "s" : ""}`
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
  selectedRepoPath: string | null;
  selectedRepositorySection: RepositorySectionId;
  disabled: boolean;
  selectedRepoPromptValidationErrorCount: number;
  repoPromptErrorCountByPath: Record<string, number>;
  onSelectRepoPath: (next: string) => void;
  onSelectSection: (next: RepositorySectionId) => void;
};

export function RepositorySidebar({
  workspaces,
  selectedRepoPath,
  selectedRepositorySection,
  disabled,
  selectedRepoPromptValidationErrorCount,
  repoPromptErrorCountByPath,
  onSelectRepoPath,
  onSelectSection,
}: RepositorySidebarProps): ReactElement {
  return (
    <aside className="space-y-3 border-r border-border bg-muted p-3">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Repository</Label>
        <RepositorySelector
          workspaces={workspaces}
          value={selectedRepoPath ?? ""}
          placeholder={workspaces.length > 0 ? "Select repository" : "No repository configured"}
          searchPlaceholder="Search repository..."
          disabled={disabled || workspaces.length === 0}
          errorCountByPath={repoPromptErrorCountByPath}
          onValueChange={onSelectRepoPath}
        />
      </div>

      <div className="space-y-1">
        {REPOSITORY_SECTIONS.map((entry) => {
          const sectionErrorCount =
            entry.id === "prompts" ? selectedRepoPromptValidationErrorCount : 0;
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
                  ? `${sectionErrorCount} prompt placeholder error${sectionErrorCount > 1 ? "s" : ""}`
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
