import {
  type ChatSettings,
  CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER,
  type CustomPrompt,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type CustomPromptValidationMap, createCustomPromptDraft } from "./settings-model";

type CustomPromptField = "name" | "description" | "content";

type SettingsCustomPromptsSectionProps = {
  customPrompts: ChatSettings["customPrompts"];
  validationErrors: CustomPromptValidationMap;
  disabled: boolean;
  onUpdateCustomPrompts: (
    updater: (current: ChatSettings["customPrompts"]) => ChatSettings["customPrompts"],
  ) => void;
};

export function SettingsCustomPromptsSection({
  customPrompts,
  validationErrors,
  disabled,
  onUpdateCustomPrompts,
}: SettingsCustomPromptsSectionProps): ReactElement {
  const addCustomPrompt = (): void => {
    onUpdateCustomPrompts((current) => [...current, createCustomPromptDraft()]);
  };

  const removeCustomPrompt = (promptId: string): void => {
    onUpdateCustomPrompts((current) => current.filter((entry) => entry.id !== promptId));
  };

  const updateCustomPromptField = (
    promptId: string,
    field: CustomPromptField,
    value: string,
  ): void => {
    onUpdateCustomPrompts((current) =>
      current.map((entry) => (entry.id === promptId ? { ...entry, [field]: value } : entry)),
    );
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground">Custom prompts</h4>
          <p className="text-xs text-muted-foreground">
            Save reusable markdown prompts and invoke them as slash commands in Agent Studio.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={addCustomPrompt}
        >
          Add prompt
        </Button>
      </div>

      {customPrompts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          No custom prompts yet. Add one to make it available from the chat composer with
          <span className="font-medium text-foreground"> /name</span>.
        </div>
      ) : (
        <CustomPromptEditorList
          customPrompts={customPrompts}
          validationErrors={validationErrors}
          disabled={disabled}
          onRemoveCustomPrompt={removeCustomPrompt}
          onUpdateCustomPromptField={updateCustomPromptField}
        />
      )}
    </div>
  );
}

type CustomPromptEditorListProps = {
  customPrompts: CustomPrompt[];
  validationErrors: CustomPromptValidationMap;
  disabled: boolean;
  onRemoveCustomPrompt: (promptId: string) => void;
  onUpdateCustomPromptField: (promptId: string, field: CustomPromptField, value: string) => void;
};

function CustomPromptEditorList({
  customPrompts,
  validationErrors,
  disabled,
  onRemoveCustomPrompt,
  onUpdateCustomPromptField,
}: CustomPromptEditorListProps): ReactElement {
  return (
    <div className="space-y-4">
      {customPrompts.map((prompt, index) => (
        <CustomPromptEditorCard
          key={prompt.id}
          prompt={prompt}
          index={index}
          errors={validationErrors[prompt.id] ?? {}}
          disabled={disabled}
          onRemoveCustomPrompt={onRemoveCustomPrompt}
          onUpdateCustomPromptField={onUpdateCustomPromptField}
        />
      ))}
    </div>
  );
}

type CustomPromptEditorCardProps = {
  prompt: CustomPrompt;
  index: number;
  errors: CustomPromptValidationMap[string];
  disabled: boolean;
  onRemoveCustomPrompt: (promptId: string) => void;
  onUpdateCustomPromptField: (promptId: string, field: CustomPromptField, value: string) => void;
};

function CustomPromptEditorCard({
  prompt,
  index,
  errors,
  disabled,
  onRemoveCustomPrompt,
  onUpdateCustomPromptField,
}: CustomPromptEditorCardProps): ReactElement {
  const nameInputId = `custom-prompt-${prompt.id}-name`;
  const descriptionInputId = `custom-prompt-${prompt.id}-description`;
  const contentInputId = `custom-prompt-${prompt.id}-content`;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Prompt {index + 1}</p>
          <p className="text-xs text-muted-foreground">
            The name becomes the slash command trigger.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onRemoveCustomPrompt(prompt.id)}
        >
          Delete
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={nameInputId}>Name</Label>
          <Input
            id={nameInputId}
            value={prompt.name}
            disabled={disabled}
            placeholder="review"
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => updateCustomPromptName(event.target.value)}
          />
          {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={descriptionInputId}>Description</Label>
          <Input
            id={descriptionInputId}
            value={prompt.description}
            disabled={disabled}
            placeholder="Explain what this prompt does"
            onChange={(event) => updateCustomPromptDescription(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={contentInputId}>Content</Label>
        <Textarea
          id={contentInputId}
          value={prompt.content}
          disabled={disabled}
          rows={6}
          placeholder={`Write markdown prompt content. Use ${CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER} to insert command text.`}
          aria-invalid={errors.content ? true : undefined}
          onChange={(event) => updateCustomPromptContent(event.target.value)}
        />
        {errors.content ? <p className="text-xs text-destructive">{errors.content}</p> : null}
      </div>
    </div>
  );

  function updateCustomPromptName(value: string): void {
    onUpdateCustomPromptField(prompt.id, "name", value);
  }

  function updateCustomPromptDescription(value: string): void {
    onUpdateCustomPromptField(prompt.id, "description", value);
  }

  function updateCustomPromptContent(value: string): void {
    onUpdateCustomPromptField(prompt.id, "content", value);
  }
}
