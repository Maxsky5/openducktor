import { type ChatSettings, CUSTOM_PROMPT_ARGUMENTS_PLACEHOLDER } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type CustomPromptValidationMap, createCustomPromptDraft } from "./settings-model";

type SettingsChatSectionProps = {
  chat: ChatSettings;
  validationErrors: CustomPromptValidationMap;
  disabled: boolean;
  onUpdateChat: (updater: (current: ChatSettings) => ChatSettings) => void;
};

export function SettingsChatSection({
  chat,
  validationErrors,
  disabled,
  onUpdateChat,
}: SettingsChatSectionProps): ReactElement {
  const addCustomPrompt = (): void => {
    const prompt = createCustomPromptDraft();
    onUpdateChat((current) => ({
      ...current,
      customPrompts: [...current.customPrompts, prompt],
    }));
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Chat Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure chat display behavior for Agent Studio sessions.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Show Thinking Messages</p>
            <p className="text-xs text-muted-foreground">
              Thinking messages are hidden by default. When enabled, they will appear in the Agent
              Studio transcript after you save settings.
            </p>
          </div>
          <Switch
            checked={chat.showThinkingMessages}
            onCheckedChange={(checked) =>
              onUpdateChat((current) => ({ ...current, showThinkingMessages: checked }))
            }
            disabled={disabled}
            aria-label="Show thinking messages in Agent Studio transcript"
          />
        </div>
      </div>

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

        {chat.customPrompts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            No custom prompts yet. Add one to make it available from the chat composer with
            <span className="font-medium text-foreground"> /name</span>.
          </div>
        ) : (
          <div className="space-y-4">
            {chat.customPrompts.map((prompt, index) => {
              const errors = validationErrors[prompt.id] ?? {};
              const nameInputId = `custom-prompt-${prompt.id}-name`;
              const descriptionInputId = `custom-prompt-${prompt.id}-description`;
              const contentInputId = `custom-prompt-${prompt.id}-content`;
              return (
                <div
                  key={prompt.id}
                  className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                >
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
                      onClick={() =>
                        onUpdateChat((current) => ({
                          ...current,
                          customPrompts: current.customPrompts.filter(
                            (entry) => entry.id !== prompt.id,
                          ),
                        }))
                      }
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
                        onChange={(event) =>
                          onUpdateChat((current) => ({
                            ...current,
                            customPrompts: current.customPrompts.map((entry) =>
                              entry.id === prompt.id
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          }))
                        }
                      />
                      {errors.name ? (
                        <p className="text-xs text-destructive">{errors.name}</p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={descriptionInputId}>Description</Label>
                      <Input
                        id={descriptionInputId}
                        value={prompt.description}
                        disabled={disabled}
                        placeholder="Explain what this prompt does"
                        onChange={(event) =>
                          onUpdateChat((current) => ({
                            ...current,
                            customPrompts: current.customPrompts.map((entry) =>
                              entry.id === prompt.id
                                ? { ...entry, description: event.target.value }
                                : entry,
                            ),
                          }))
                        }
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
                      onChange={(event) =>
                        onUpdateChat((current) => ({
                          ...current,
                          customPrompts: current.customPrompts.map((entry) =>
                            entry.id === prompt.id
                              ? { ...entry, content: event.target.value }
                              : entry,
                          ),
                        }))
                      }
                    />
                    {errors.content ? (
                      <p className="text-xs text-destructive">{errors.content}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Changes to chat settings will take effect after you save your settings.
      </div>
    </div>
  );
}
