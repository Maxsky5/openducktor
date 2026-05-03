import { REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER, type ReusablePrompt } from "@openducktor/contracts";
import { CircleAlert, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createReusablePromptDraft, type ReusablePromptValidationMap } from "./settings-model";

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
    <div className="grid h-full lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex h-full min-h-0 flex-col gap-3 border-r border-border bg-muted/50 p-3">
        <div className="shrink-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reusable prompts
          </p>
          <p className="text-xs text-muted-foreground">Reusable slash commands for chats.</p>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {reusablePrompts.map((prompt) => {
            const errorCount = countPromptErrors(validationErrors[prompt.id]);
            const isSelected = prompt.id === selectedPrompt?.id;
            return (
              <Button
                key={prompt.id}
                type="button"
                variant={isSelected ? "accent" : "ghost"}
                className="w-full justify-between"
                disabled={disabled}
                onClick={() => onSelectedReusablePromptIdChange(prompt.id)}
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
          onClick={addReusablePrompt}
        >
          Add prompt
        </Button>
      </aside>

      <div className="min-w-0 p-4">
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
      </div>
    </div>
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
          Use {REUSABLE_PROMPT_ARGUMENTS_PLACEHOLDER} in the content to insert text typed after the
          slash command.
        </p>
        <Button type="button" disabled={disabled} onClick={onAddReusablePrompt}>
          Add reusable prompt
        </Button>
      </div>
    </div>
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
  const nameInputId = `custom-prompt-${prompt.id}-name`;
  const descriptionInputId = `custom-prompt-${prompt.id}-description`;
  const contentInputId = `custom-prompt-${prompt.id}-content`;
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
          onClick={() => onRemoveReusablePrompt(prompt.id)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </Button>
      </div>

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
    </div>
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
