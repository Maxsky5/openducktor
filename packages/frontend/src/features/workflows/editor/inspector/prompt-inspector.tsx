import {
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  WORKFLOW_PROMPT_IDS,
  workflowPromptPurposeSchema,
  type WorkflowPrompt,
} from "@openducktor/contracts";
import {
  BASE_PROMPT_IDS,
  builtinWorkflowDocument,
  elementKey,
  workflowPromptPlaceholders,
} from "@openducktor/workflows";
import { MessageSquareText, Plus } from "lucide-react";
import { type ReactElement, useId } from "react";
import { PromptTextField } from "@/components/features/settings/settings-prompt-text-field";
import { Button } from "@/components/ui/button";
import { elementIds } from "../model/document-elements";
import { addMessagePrompt, addPrompt, updatePrompt, withOptional } from "../model/document-edits";
import { NewElementButton } from "../panels/new-element-button";
import { vocabularyOptions } from "./element-options";
import { FieldShell } from "./field-shell";
import { SelectField } from "./reference-fields";
import { IdField, TextField } from "./text-fields";
import { fieldCoalesceKey, useInspector } from "./inspector-context";
import { InspectorSection } from "./inspector-section";
import { PickedChips } from "./toggle-chips";

const BUILTIN_PROMPTS = new Map(
  builtinWorkflowDocument().prompts.map((prompt) => [prompt.id, prompt]),
);

const promptIdProblem = (text: string): string | undefined =>
  BASE_PROMPT_IDS.has(text) || text.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX)
    ? undefined
    : `A prompt ID is a base prompt ID or starts with "${WORKFLOW_MESSAGE_PROMPT_PREFIX}".`;

export function PromptInspector({ prompt }: { prompt: WorkflowPrompt }): ReactElement {
  const { document, change, rename, elementKey: key, readOnly } = useInspector();
  const templateId = useId();
  const edit = (update: (value: WorkflowPrompt) => WorkflowPrompt, field?: string) =>
    change(
      (current) => updatePrompt(current, prompt.id, update),
      field ? { coalesceKey: fieldCoalesceKey(key, [field]) } : {},
    );
  const base = BASE_PROMPT_IDS.has(prompt.id);
  const placeholders = workflowPromptPlaceholders(document.definition, prompt.id);
  const required = prompt.requiredPlaceholders ?? [];
  return (
    <InspectorSection title="Prompt" Icon={MessageSquareText} color="orange">
      <IdField
        path={["id"]}
        value={prompt.id}
        taken={elementIds(document, "prompt")}
        fixed={base}
        validate={promptIdProblem}
        hint={base ? "Every workflow uses this base prompt ID." : undefined}
        onCommit={(next) => rename("prompt", prompt.id, next)}
      />
      <TextField
        label="Name"
        path={["label"]}
        value={prompt.label}
        onChange={(label) => edit((current) => ({ ...current, label }), "label")}
      />
      <TextField
        label="Description"
        path={["description"]}
        value={prompt.description}
        multiline
        onChange={(description) => edit((current) => ({ ...current, description }), "description")}
      />
      <SelectField
        label="Purpose"
        path={["purpose"]}
        value={prompt.purpose}
        options={vocabularyOptions(workflowPromptPurposeSchema.options)}
        onChange={(purpose) => purpose && edit((current) => ({ ...current, purpose }))}
      />
      {base ? (
        prompt.requiredPlaceholders && prompt.requiredPlaceholders.length > 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Required placeholders:{" "}
            <span className="font-mono">
              {prompt.requiredPlaceholders.map((name) => `{{${name}}}`).join(", ")}
            </span>
          </p>
        ) : null
      ) : (
        <FieldShell
          label="Required placeholders"
          path={["requiredPlaceholders"]}
          labelId={`${templateId}-required`}
          hint="The text must use each of them, so a later edit cannot drop one by mistake."
        >
          <PickedChips
            label="Required placeholders"
            values={required}
            options={[...new Set([...placeholders, ...required])].map((name) => ({
              value: name,
              label: `{{${name}}}`,
            }))}
            onChange={(names) => {
              const picked = new Set(names);
              const chosen = [...new Set([...placeholders, ...required])].filter((name) =>
                picked.has(name),
              );
              edit((current) =>
                withOptional(
                  current,
                  "requiredPlaceholders",
                  chosen.length > 0 ? chosen : undefined,
                ),
              );
            }}
          />
        </FieldShell>
      )}
      <FieldShell
        label="Text"
        path={["template"]}
        labelId={`${templateId}-label`}
        controlId={templateId}
      >
        <PromptTextField
          id={templateId}
          value={prompt.template}
          rows={14}
          disabled={readOnly}
          placeholders={placeholders}
          error={undefined}
          onChange={(template) => edit((current) => ({ ...current, template }), "template")}
        />
      </FieldShell>
    </InspectorSection>
  );
}

/** The prompt list, with the base prompts and the goal prompt that the workflow lacks. */
export function PromptsOverview(): ReactElement {
  const { document, create, select, readOnly } = useInspector();
  const present = new Set(document.prompts.map(({ id }) => id));
  const missing = [...BUILTIN_PROMPTS.values()].filter(
    ({ id }) => !present.has(id) && (BASE_PROMPT_IDS.has(id) || id === WORKFLOW_PROMPT_IDS.goal),
  );
  return (
    <InspectorSection title="Prompts" Icon={MessageSquareText} color="orange">
      <p className="text-xs leading-5 text-muted-foreground">
        Prompt text is part of the draft and of each version. Settings overrides and appends apply
        on top of it.
      </p>
      <ul className="flex flex-col gap-1">
        {document.prompts.map((prompt) => (
          <li key={prompt.id}>
            <button
              type="button"
              className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => select(elementKey("prompt", prompt.id))}
            >
              <span className="min-w-0 truncate">{prompt.label || prompt.id}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {prompt.id}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          {missing.map((prompt) => (
            <Button
              key={prompt.id}
              type="button"
              size="xs"
              variant="outline"
              onClick={() => create((current) => addPrompt(current, structuredClone(prompt)))}
            >
              <Plus className="size-3.5" />
              Add {prompt.id === WORKFLOW_PROMPT_IDS.goal ? "goal prompt" : prompt.label}
            </Button>
          ))}
          <NewElementButton
            label="Add message prompt"
            placeholder="Prompt name"
            onCreate={(name) => create((current) => addMessagePrompt(current, name))}
          />
        </div>
      )}
    </InspectorSection>
  );
}
