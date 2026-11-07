type AgentPromptTemplateId = string;
type WorkflowPromptRoleTabId = string;
import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  canClearPromptOverride,
  clearPromptOverride,
  resolvePromptOverrideFallbackTemplate,
  togglePromptOverrideEnabled,
  updatePromptOverrideTemplate,
} from "@/components/features/settings";
import { PromptOverrideCard, PromptRoleTabs } from "./settings-modal-prompt-components";
import type { PromptInheritedPreview } from "./settings-prompt-inheritance";

type PromptOverridesSectionProps = {
  title: string;
  description: string;
  tab: WorkflowPromptRoleTabId;
  errorCountsByTab: Record<WorkflowPromptRoleTabId, number>;
  overrides: RepoPromptOverrides;
  validationErrors: Partial<Record<AgentPromptTemplateId, string>>;
  disabled: boolean;
  onTabChange: (next: WorkflowPromptRoleTabId) => void;
  onUpdateOverrides: (updater: (current: RepoPromptOverrides) => RepoPromptOverrides) => void;
  resolveInheritedPreview: (
    templateId: AgentPromptTemplateId,
    builtinTemplate: string,
    override: RepoPromptOverrides[AgentPromptTemplateId] | undefined,
  ) => PromptInheritedPreview | undefined;
};

export function PromptOverridesSection({
  title,
  description,
  tab,
  errorCountsByTab,
  overrides,
  validationErrors,
  disabled,
  onTabChange,
  onUpdateOverrides,
  resolveInheritedPreview,
}: PromptOverridesSectionProps): ReactElement {
  const workflows = useWorkflowSettings();
  if (workflows.error) return <p role="alert">{workflows.error.message}</p>;
  if (!workflows.data) return <p role="status">Loading workflow prompts...</p>;
  const selectedTab = workflows.data.promptTabs.find(
    ({ id, roleId }) => id === tab || roleId === tab,
  );
  if (!selectedTab)
    return (
      <div className="p-4">
        <PromptRoleTabs
          value={tab}
          onChange={onTabChange}
          errorCounts={errorCountsByTab}
          disabled={disabled}
        />
        <p role="alert">Choose a workflow role to view its prompts.</p>
      </div>
    );
  const visibleErrorCount = selectedTab.templates.filter(({ key }) => validationErrors[key]).length;

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <PromptRoleTabs
        value={selectedTab.id}
        onChange={onTabChange}
        errorCounts={errorCountsByTab}
        disabled={disabled}
      />

      {visibleErrorCount > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {visibleErrorCount} prompt placeholder error{visibleErrorCount > 1 ? "s" : ""} in this
          tab.
        </div>
      ) : null}

      <div className="grid gap-3">
        {selectedTab.templates.map((builtin) => {
          const templateId = builtin.key;
          const override = overrides[templateId];
          const inheritedPreview = resolveInheritedPreview(templateId, builtin.template, override);
          const canClearOverride = canClearPromptOverride(override);
          const enableFallbackTemplate = resolvePromptOverrideFallbackTemplate(
            inheritedPreview?.template,
            builtin.template,
          );

          return (
            <PromptOverrideCard
              key={builtin.key}
              label={builtin.label}
              owner={builtin.owner}
              description={builtin.description}
              override={override}
              inheritedPreview={inheritedPreview}
              disabled={disabled}
              canClearOverride={canClearOverride}
              validationError={validationErrors[templateId]}
              onToggleEnabled={(nextEnabled) => {
                onUpdateOverrides((currentOverrides) =>
                  togglePromptOverrideEnabled(
                    currentOverrides,
                    templateId,
                    nextEnabled,
                    enableFallbackTemplate,
                    builtin.builtinVersion,
                  ),
                );
              }}
              onTemplateChange={(nextTemplate) => {
                onUpdateOverrides((currentOverrides) =>
                  updatePromptOverrideTemplate(
                    currentOverrides,
                    templateId,
                    nextTemplate,
                    builtin.builtinVersion,
                  ),
                );
              }}
              onClearOverride={() => {
                onUpdateOverrides((currentOverrides) =>
                  clearPromptOverride(currentOverrides, templateId),
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
