import {
  type ChatSettings,
  CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER,
  type CustomPrompt,
} from "@openducktor/contracts";
import { CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type CustomPromptValidationMap, createCustomPromptDraft } from "./settings-model";

type CustomPromptField = "name" | "description" | "content";

type SettingsCustomPromptsSectionProps = {
  customPrompts: ChatSettings["customPrompts"];
  selectedCustomPromptId: string | null;
  validationErrors: CustomPromptValidationMap;
  disabled: boolean;
  onSelectedCustomPromptIdChange: (promptId: string | null) => void;
  onUpdateCustomPrompts: (
    updater: (current: ChatSettings["customPrompts"]) => ChatSettings["customPrompts"],
  ) => void;
};

const getPromptTabLabel = (prompt: CustomPrompt): string => {
  const name = prompt.name.trim();
  return name.length > 0 ? name : "Untitled prompt";
};

const countPromptErrors = (errors: CustomPromptValidationMap[string] | undefined): number =>
  (errors?.name ? 1 : 0) + (errors?.content ? 1 : 0);

const resolveSelectedPrompt = (
  customPrompts: CustomPrompt[],
  selectedCustomPromptId: string | null,
): CustomPrompt | null => {
  if (customPrompts.length === 0) {
    return null;
  }
  return (
    customPrompts.find((prompt) => prompt.id === selectedCustomPromptId) ?? customPrompts[0] ?? null
  );
};

export function SettingsCustomPromptsSection({
  customPrompts,
  selectedCustomPromptId,
  validationErrors,
  disabled,
  onSelectedCustomPromptIdChange,
  onUpdateCustomPrompts,
}: SettingsCustomPromptsSectionProps): ReactElement {
  const selectedPrompt = resolveSelectedPrompt(customPrompts, selectedCustomPromptId);

  const addCustomPrompt = (): void => {
    const prompt = createCustomPromptDraft();
    onUpdateCustomPrompts((current) => [...current, prompt]);
    onSelectedCustomPromptIdChange(prompt.id);
  };

  const removeCustomPrompt = (promptId: string): void => {
    const currentIndex = customPrompts.findIndex((prompt) => prompt.id === promptId);
    const remainingPrompts = customPrompts.filter((prompt) => prompt.id !== promptId);
    const nextPrompt = remainingPrompts[currentIndex] ?? remainingPrompts[currentIndex - 1] ?? null;

    onUpdateCustomPrompts(() => remainingPrompts);
    if (selectedPrompt?.id === promptId) {
      onSelectedCustomPromptIdChange(nextPrompt?.id ?? null);
    }
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
    <div className="grid h-full lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex h-full min-h-0 flex-col gap-3 border-r border-border bg-muted/50 p-3">
        <div className="shrink-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reusable prompts
          </p>
          <p className="text-xs text-muted-foreground">Reusable slash commands for chats.</p>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {customPrompts.map((prompt) => {
            const errorCount = countPromptErrors(validationErrors[prompt.id]);
            const isSelected = prompt.id === selectedPrompt?.id;
            return (
              <Button
                key={prompt.id}
                type="button"
                variant={isSelected ? "accent" : "ghost"}
                className="w-full justify-between"
                disabled={disabled}
                onClick={() => onSelectedCustomPromptIdChange(prompt.id)}
                title={
                  errorCount > 0
                    ? `${errorCount} reusable prompt field error${errorCount > 1 ? "s" : ""}`
                    : undefined
                }
              >
                <span className="min-w-0 truncate text-left">{getPromptTabLabel(prompt)}</span>
                {errorCount > 0 ? (
                  <CircleAlert
                    className="ml-2 size-3.5 shrink-0 text-destructive-muted"
                    aria-hidden="true"
                  />
                ) : null}
              </Button>
            );
          })}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full shrink-0"
          disabled={disabled}
          onClick={addCustomPrompt}
        >
          Add prompt
        </Button>
      </aside>

      <div className="min-w-0 p-4">
        {selectedPrompt ? (
          <CustomPromptEditorCard
            prompt={selectedPrompt}
            errors={validationErrors[selectedPrompt.id] ?? {}}
            disabled={disabled}
            onRemoveCustomPrompt={removeCustomPrompt}
            onUpdateCustomPromptField={updateCustomPromptField}
          />
        ) : (
          <CustomPromptsEmptyState disabled={disabled} onAddCustomPrompt={addCustomPrompt} />
        )}
      </div>
    </div>
  );
}

type CustomPromptsEmptyStateProps = {
  disabled: boolean;
  onAddCustomPrompt: () => void;
};

function CustomPromptsEmptyState({
  disabled,
  onAddCustomPrompt,
}: CustomPromptsEmptyStateProps): ReactElement {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-border bg-card p-6 text-center">
      <div className="max-w-md space-y-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">
            Create your first reusable prompt
          </h3>
          <p className="text-sm text-muted-foreground">
            Save reusable markdown prompts and invoke them in chat with a slash command like
            <span className="font-medium text-foreground"> /review</span>.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Use {CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER} in the content to insert text typed after the
          slash command.
        </p>
        <Button type="button" disabled={disabled} onClick={onAddCustomPrompt}>
          Add reusable prompt
        </Button>
      </div>
    </div>
  );
}

type CustomPromptEditorCardProps = {
  prompt: CustomPrompt;
  errors: CustomPromptValidationMap[string];
  disabled: boolean;
  onRemoveCustomPrompt: (promptId: string) => void;
  onUpdateCustomPromptField: (promptId: string, field: CustomPromptField, value: string) => void;
};

function CustomPromptEditorCard({
  prompt,
  errors,
  disabled,
  onRemoveCustomPrompt,
  onUpdateCustomPromptField,
}: CustomPromptEditorCardProps): ReactElement {
  const nameInputId = `custom-prompt-${prompt.id}-name`;
  const descriptionInputId = `custom-prompt-${prompt.id}-description`;
  const contentInputId = `custom-prompt-${prompt.id}-content`;
  const promptTriggerPreview = prompt.name.trim() ? `/${prompt.name.trim()}` : "/name";

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{getPromptTabLabel(prompt)}</h3>
          <p className="text-xs text-muted-foreground">
            This prompt appears in chat as
            <span className="font-medium text-foreground"> {promptTriggerPreview}</span>.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
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
            onChange={(event) => updateCustomPromptDescription(event.target.value)}
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
          placeholder={`Write markdown prompt content. Use ${CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER} to insert command text.`}
          aria-invalid={errors.content ? true : undefined}
          onChange={(event) => updateCustomPromptContent(event.target.value)}
        />
        {errors.content ? (
          <p className="text-xs text-destructive">{errors.content}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            If the content does not include {CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER}, text typed after
            the slash command is appended on a new line.
          </p>
        )}
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
