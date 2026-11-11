import { useWorkflowPromptSettings } from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import { type ReactElement, useState } from "react";
import { PromptHome } from "./settings-prompt-home";
import { PromptLayerEditor } from "./settings-prompt-layer-editor";
import type {
  PromptScope,
  PromptSettingsLayersUpdater,
  PromptValidationErrors,
} from "./settings-prompt-layers";
import {
  PROMPT_HOME_VIEW,
  promptHomeView,
  promptRoleChips,
  promptWorkflow,
  type PromptView,
} from "./settings-prompt-owners";
import { PromptWorkflowPage } from "./settings-prompt-workflow-page";

type PromptLayersSectionProps = {
  title: string;
  description: string;
  /** The layers that this screen edits, and for Repository prompts the global layers below them. */
  scope: PromptScope;
  /** The placeholder problems of the layers of this screen. */
  validationErrors: PromptValidationErrors;
  view: PromptView;
  disabled: boolean;
  onViewChange: (view: PromptView) => void;
  onUpdateLayers: (updater: PromptSettingsLayersUpdater) => void;
};

/**
 * The prompts of System or Repository prompts, on three levels: the first screen, the page of a
 * workflow, and the editor of one prompt. Back returns to the level that opened the prompt.
 */
export function PromptLayersSection({
  title,
  description,
  scope,
  validationErrors,
  view,
  disabled,
  onViewChange,
  onUpdateLayers,
}: PromptLayersSectionProps): ReactElement {
  const prompts = useWorkflowPromptSettings();
  // The filter stays while the user opens and closes prompts.
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  // The prompt or the workflow that the user just left. Its row gets the focus again.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  if (prompts.error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive-muted">
        {prompts.error.message}
      </p>
    );
  if (!prompts.data)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading workflow prompts...
      </p>
    );
  const { roles, roleTemplates, workflows, templates } = prompts.data;
  const show = (next: PromptView, focus: string | null = null): void => {
    setFocusKey(focus);
    onViewChange(next);
  };
  const workflowOf = (id: string | null) => workflows.find((workflow) => workflow.id === id);

  const prompt =
    view.screen === "prompt" ? templates.find(({ key }) => key === view.key) : undefined;
  if (view.screen === "prompt" && prompt) {
    const backTo = workflowOf(view.backToWorkflowId);
    return (
      <PromptLayerEditor
        key={prompt.key}
        template={prompt}
        backTitle={backTo?.title ?? title}
        scope={scope}
        errors={validationErrors[prompt.key]}
        disabled={disabled}
        onBack={() =>
          show(
            backTo ? { screen: "workflow", workflowId: backTo.id } : PROMPT_HOME_VIEW,
            prompt.key,
          )
        }
        onUpdateLayers={onUpdateLayers}
      />
    );
  }

  const context = { roles: promptRoleChips(roles), scope, validationErrors };
  const workflow = view.screen === "workflow" ? workflowOf(view.workflowId) : undefined;
  if (workflow)
    return (
      <PromptWorkflowPage
        backTitle={title}
        workflow={promptWorkflow(workflow, context)}
        focusKey={focusKey}
        disabled={disabled}
        onBack={() => show(PROMPT_HOME_VIEW, workflow.id)}
        onOpenPrompt={(key) => show({ screen: "prompt", key, backToWorkflowId: workflow.id })}
      />
    );
  return (
    <PromptHome
      title={title}
      description={description}
      view={promptHomeView(
        { roleTemplates, workflows },
        { query: query.trim().toLowerCase(), changedOnly },
        context,
      )}
      query={query}
      changedOnly={changedOnly}
      focusKey={focusKey}
      disabled={disabled}
      onQueryChange={setQuery}
      onChangedOnlyChange={setChangedOnly}
      onOpenPrompt={(key) => show({ screen: "prompt", key, backToWorkflowId: null })}
      onOpenWorkflow={(workflowId) => show({ screen: "workflow", workflowId })}
    />
  );
}
