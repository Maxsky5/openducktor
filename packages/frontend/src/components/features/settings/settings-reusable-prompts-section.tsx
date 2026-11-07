import { REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER, type ReusablePrompt } from "@openducktor/contracts";
import { type ReactElement, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createReusablePromptDraft,
  type ReusablePromptValidationMap,
} from "@/state/read-models/settings-read-model";
import {
  SettingsListEditor,
  SettingsListEditorCard,
  SettingsListEditorEmptyState,
} from "./settings-list-editor";

type ReusablePromptField = "name" | "description" | "content";

type SettingsReusablePromptsSectionProps = {
  reusablePrompts: ReusablePrompt[];
  selectedReusablePromptId: string | null;
  validationErrors: ReusablePromptValidationMap;
  disabled: boolean;
  onSelectedReusablePromptIdChange: (promptId: string | null) => void;
  onUpdateReusablePrompts: (updater: (current: ReusablePrompt[]) => ReusablePrompt[]) => void;
};

const getPromptTabLabel = (prompt: ReusablePrompt): string => {
  const name = prompt.name.trim();
  return name.length > 0 ? name : "Untitled prompt";
};

const countPromptErrors = (errors: ReusablePromptValidationMap[string] | undefined): number =>
  (errors?.name ? 1 : 0) + (errors?.content ? 1 : 0);

const resolveSelectedPrompt = (
  reusablePrompts: ReusablePrompt[],
  selectedReusablePromptId: string | null,
): ReusablePrompt | null => {
  if (reusablePrompts.length === 0) {
    return null;
  }
  return (
    reusablePrompts.find((prompt) => prompt.id === selectedReusablePromptId) ??
    reusablePrompts[0] ??
    null
  );
};

export function SettingsReusablePromptsSection({
  reusablePrompts,
  selectedReusablePromptId,
  validationErrors,
  disabled,
  onSelectedReusablePromptIdChange,
  onUpdateReusablePrompts,
}: SettingsReusablePromptsSectionProps): ReactElement {
  const selectedPrompt = resolveSelectedPrompt(reusablePrompts, selectedReusablePromptId);
  const promptIdToAutofocusRef = useRef<string | null>(null);

  const addReusablePrompt = (): void => {
    const prompt = createReusablePromptDraft();
    promptIdToAutofocusRef.current = prompt.id;
    onUpdateReusablePrompts((current) => [...current, prompt]);
    onSelectedReusablePromptIdChange(prompt.id);
  };

  const removeReusablePrompt = (promptId: string): void => {
    const currentIndex = reusablePrompts.findIndex((prompt) => prompt.id === promptId);
    const remainingPrompts = reusablePrompts.filter((prompt) => prompt.id !== promptId);
    const nextPrompt = remainingPrompts[currentIndex] ?? remainingPrompts[currentIndex - 1] ?? null;

    onUpdateReusablePrompts(() => remainingPrompts);
    if (selectedPrompt?.id === promptId) {
      onSelectedReusablePromptIdChange(nextPrompt?.id ?? null);
    }
  };

  const updateReusablePromptField = (
    promptId: string,
    field: ReusablePromptField,
    value: string,
  ): void => {
    onUpdateReusablePrompts((current) =>
      current.map((entry) => (entry.id === promptId ? { ...entry, [field]: value } : entry)),
    );
  };

  const shouldAutofocusName = selectedPrompt?.id === promptIdToAutofocusRef.current;

  return (
    <SettingsListEditor
      title="Reusable prompts"
      description="Reusable slash commands for sessions."
      items={reusablePrompts.map((prompt) => {
        const count = countPromptErrors(validationErrors[prompt.id]);
        return {
          id: prompt.id,
          label: getPromptTabLabel(prompt),
          errorTitle:
            count > 0 ? `${count} reusable prompt field error${count > 1 ? "s" : ""}` : undefined,
        };
      })}
      selectedId={selectedPrompt?.id ?? null}
      disabled={disabled}
      addLabel="Add prompt"
      onSelect={onSelectedReusablePromptIdChange}
      onAdd={addReusablePrompt}
    >
      {selectedPrompt ? (
        <ReusablePromptEditorCard
          prompt={selectedPrompt}
          errors={validationErrors[selectedPrompt.id] ?? {}}
          disabled={disabled}
          shouldAutofocusName={shouldAutofocusName}
          onNameAutofocused={() => {
            promptIdToAutofocusRef.current = null;
          }}
          onRemoveReusablePrompt={removeReusablePrompt}
          onUpdateReusablePromptField={updateReusablePromptField}
        />
      ) : (
        <ReusablePromptsEmptyState disabled={disabled} onAddReusablePrompt={addReusablePrompt} />
      )}
    </SettingsListEditor>
  );
}

type ReusablePromptsEmptyStateProps = {
  disabled: boolean;
  onAddReusablePrompt: () => void;
};

function ReusablePromptsEmptyState({
  disabled,
  onAddReusablePrompt,
}: ReusablePromptsEmptyStateProps): ReactElement {
  return (
    <SettingsListEditorEmptyState
      title="Create your first reusable prompt"
      addLabel="Add reusable prompt"
      disabled={disabled}
      onAdd={onAddReusablePrompt}
    >
      <p className="text-sm text-muted-foreground">
        Save reusable markdown prompts and invoke them in a session with a slash command like
        <span className="font-medium text-foreground"> /review</span>.
      </p>
      <p className="text-xs text-muted-foreground">
        Use {REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER} in the content to insert text typed after the
        slash command.
      </p>
    </SettingsListEditorEmptyState>
  );
}

type ReusablePromptEditorCardProps = {
  prompt: ReusablePrompt;
  errors: ReusablePromptValidationMap[string];
  disabled: boolean;
  shouldAutofocusName: boolean;
  onNameAutofocused: () => void;
  onRemoveReusablePrompt: (promptId: string) => void;
  onUpdateReusablePromptField: (
    promptId: string,
    field: ReusablePromptField,
    value: string,
  ) => void;
};

function ReusablePromptEditorCard({
  prompt,
  errors,
  disabled,
  shouldAutofocusName,
  onNameAutofocused,
  onRemoveReusablePrompt,
  onUpdateReusablePromptField,
}: ReusablePromptEditorCardProps): ReactElement {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputId = `reusable-prompt-${prompt.id}-name`;
  const descriptionInputId = `reusable-prompt-${prompt.id}-description`;
  const contentInputId = `reusable-prompt-${prompt.id}-content`;
  const promptTriggerPreview = prompt.name.trim() ? `/${prompt.name.trim()}` : "/name";

  useEffect(() => {
    if (!shouldAutofocusName || disabled) {
      return;
    }
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    onNameAutofocused();
  }, [disabled, onNameAutofocused, shouldAutofocusName]);

  return (
    <SettingsListEditorCard
      title={getPromptTabLabel(prompt)}
      description={
        <>
          This prompt appears in sessions as
          <span className="font-medium text-foreground"> {promptTriggerPreview}</span>.
        </>
      }
      disabled={disabled}
      onDelete={() => onRemoveReusablePrompt(prompt.id)}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={nameInputId}>Name</Label>
          <Input
            id={nameInputId}
            ref={nameInputRef}
            value={prompt.name}
            disabled={disabled}
            placeholder="review"
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => updateReusablePromptName(event.target.value)}
          />
          {errors.name ? (
            <p className="text-xs text-destructive">{errors.name}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Use letters, digits, dots, underscores, colons, or dashes. Do not include the leading
              slash.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={descriptionInputId}>Description</Label>
          <Input
            id={descriptionInputId}
            value={prompt.description}
            disabled={disabled}
            placeholder="Explain what this prompt does"
            onChange={(event) => updateReusablePromptDescription(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shown in the slash-command menu to help identify the prompt.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={contentInputId}>Content</Label>
        <Textarea
          id={contentInputId}
          value={prompt.content}
          disabled={disabled}
          rows={12}
          placeholder={`Write markdown prompt content. Use ${REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER} to insert command text.`}
          aria-invalid={errors.content ? true : undefined}
          onChange={(event) => updateReusablePromptContent(event.target.value)}
        />
        {errors.content ? (
          <p className="text-xs text-destructive">{errors.content}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            If the content does not include {REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER}, text typed
            after the slash command is appended on a new line.
          </p>
        )}
      </div>
    </SettingsListEditorCard>
  );

  function updateReusablePromptName(value: string): void {
    onUpdateReusablePromptField(prompt.id, "name", value);
  }

  function updateReusablePromptDescription(value: string): void {
    onUpdateReusablePromptField(prompt.id, "description", value);
  }

  function updateReusablePromptContent(value: string): void {
    onUpdateReusablePromptField(prompt.id, "content", value);
  }
}
