import type { AgentPromptTemplateId, RepoPromptOverrides } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  canResetPromptOverrideToBuiltin,
  resetPromptOverrideToBuiltin,
  resolvePromptOverrideFallbackTemplate,
  togglePromptOverrideEnabled,
  updatePromptOverrideTemplate,
} from "@/components/features/settings";
import type { PromptRoleTabId } from "./settings-modal-constants";
import {
  BUILTIN_PROMPTS_BY_ID,
  PROMPT_IDS_BY_ROLE,
  PROMPT_TEMPLATE_DESCRIPTIONS,
  PROMPT_TEMPLATE_LABELS,
} from "./settings-modal-constants";
import type { PromptInheritedPreview } from "./settings-modal-normalization";
import { PromptOverrideCard, PromptRoleTabs } from "./settings-modal-prompt-components";

type PromptOverridesSectionProps = {
  title: string;
  description: string;
  tab: PromptRoleTabId;
  errorCountsByTab: Record<PromptRoleTabId, number>;
  overrides: RepoPromptOverrides;
  validationErrors: Partial<Record<AgentPromptTemplateId, string>>;
  disabled: boolean;
  onTabChange: (next: PromptRoleTabId) => void;
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
  const promptIds = PROMPT_IDS_BY_ROLE[tab];
  const visibleErrorCount = promptIds.filter((templateId) =>
    Boolean(validationErrors[templateId]),
  ).length;

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <PromptRoleTabs
        value={tab}
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
        {promptIds.map((templateId) => {
          const builtin = BUILTIN_PROMPTS_BY_ID[templateId];
          const override = overrides[templateId];
          const inheritedPreview = resolveInheritedPreview(templateId, builtin.template, override);
          const canResetToBuiltin = canResetPromptOverrideToBuiltin(override, builtin.template);
          const enableFallbackTemplate = resolvePromptOverrideFallbackTemplate(
            inheritedPreview?.template,
            builtin.template,
          );

          return (
            <PromptOverrideCard
              key={templateId}
              label={PROMPT_TEMPLATE_LABELS[templateId]}
              description={PROMPT_TEMPLATE_DESCRIPTIONS[templateId]}
              override={override}
              inheritedPreview={inheritedPreview}
              disabled={disabled}
              canResetToBuiltin={canResetToBuiltin}
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
              onResetToBuiltin={() => {
                onUpdateOverrides((currentOverrides) =>
                  resetPromptOverrideToBuiltin(
                    currentOverrides,
                    templateId,
                    builtin.template,
                    builtin.builtinVersion,
                  ),
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
