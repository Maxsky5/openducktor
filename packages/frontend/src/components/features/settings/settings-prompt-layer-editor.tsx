import type { SettingsPromptTemplate } from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import {
  composePromptLayers,
  isPromptOverrideOn,
  isPromptOverrideOutdated,
  type PromptLayerProblems,
  type PromptSettingsLayers,
} from "@openducktor/workflows";
import { Trash2, TriangleAlert } from "lucide-react";
import { type ReactElement, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  inheritedPromptText,
  patchPromptAppend,
  patchPromptOverride,
  type PromptScope,
  type PromptSettingsLayersUpdater,
  promptSettingsOfScope,
  promptStatus,
  removePromptAppend,
  removePromptOverride,
  replacePrompt,
  setPromptAppendText,
} from "./settings-prompt-layers";
import { PromptFinalText } from "./settings-prompt-final-text";
import { PromptPageHeader } from "./settings-prompt-page-header";
import { PromptStatusBadges } from "./settings-prompt-status-badges";
import { PromptTextField } from "./settings-prompt-text-field";

type PromptLayerEditorProps = {
  template: SettingsPromptTemplate;
  /** The screen that the back link returns to, such as the workflow of the prompt. */
  backTitle: string;
  /** Returns to the screen that opened the prompt. */
  onBack: () => void;
  /** The layers that the screen edits, and for Repository prompts the global layers below. */
  scope: PromptScope;
  errors: PromptLayerProblems | undefined;
  disabled: boolean;
  onUpdateLayers: (updater: PromptSettingsLayersUpdater) => void;
};

function BuiltinText({ text }: { text: string }): ReactElement {
  return (
    <pre
      aria-label="Built-in text"
      className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-input bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground"
    >
      {text}
    </pre>
  );
}

/** A button that shows or hides the built-in text below it. */
function BuiltinTextToggle({ text }: { text: string }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex flex-col gap-3">
      <div>
        <CollapsibleTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            {isOpen ? "Hide built-in text" : "View built-in text"}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <BuiltinText text={text} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The label of the text field of a layer card, its description, and its controls on the right. */
function LayerHeader({
  label,
  htmlFor,
  description,
  controls,
}: {
  label: string;
  htmlFor: string;
  description: string;
  controls?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {controls}
    </div>
  );
}

/** The On switch and the remove action of a saved layer. */
function LayerControls({
  switchLabel,
  checked,
  removeLabel,
  disabled,
  onCheckedChange,
  onRemove,
}: {
  switchLabel: string;
  checked: boolean;
  removeLabel: string;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Switch
        aria-label={switchLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
        {removeLabel}
      </Button>
    </div>
  );
}

type SectionProps = Pick<PromptLayerEditorProps, "template" | "disabled" | "onUpdateLayers">;

function OutdatedNotice({ template, disabled, onUpdateLayers }: SectionProps): ReactElement {
  const { key } = template;
  return (
    <Alert variant="warning" role="note">
      <TriangleAlert aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-2">
        <AlertTitle>The built-in prompt changed</AlertTitle>
        <AlertDescription>
          Your override does not include the update. Compare it with the built-in text, then keep it
          or remove it.
        </AlertDescription>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onUpdateLayers((current) =>
                patchPromptOverride(current, key, { baseVersion: template.builtinVersion }),
              )
            }
          >
            Keep my override
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onUpdateLayers((current) => removePromptOverride(current, key))}
          >
            Remove override
          </Button>
        </div>
        <BuiltinTextToggle text={template.template} />
      </div>
    </Alert>
  );
}

function AppendSection({
  template,
  append,
  error,
  disabled,
  onUpdateLayers,
}: SectionProps & {
  append: PromptSettingsLayers["appends"][string] | undefined;
  error: string | undefined;
}): ReactElement {
  const { key } = template;
  const id = useId();
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <LayerHeader
        label="Append instructions"
        htmlFor={id}
        description="Add your own rules after this prompt. The built-in text keeps its updates."
        controls={
          append ? (
            <LayerControls
              switchLabel="Use append instructions"
              checked={append.enabled}
              removeLabel="Remove append"
              disabled={disabled}
              onCheckedChange={(enabled) =>
                onUpdateLayers((current) => patchPromptAppend(current, key, { enabled }))
              }
              onRemove={() => onUpdateLayers((current) => removePromptAppend(current, key))}
            />
          ) : null
        }
      />
      <PromptTextField
        id={id}
        value={append?.text ?? ""}
        rows={4}
        placeholder="For example: Run the linter before you finish."
        disabled={disabled}
        placeholders={template.placeholders}
        error={error}
        onChange={(text) => onUpdateLayers((current) => setPromptAppendText(current, key, text))}
      />
    </section>
  );
}

function OverrideSection({
  template,
  override,
  isOutdated,
  error,
  autoFocus,
  disabled,
  onUpdateLayers,
}: SectionProps & {
  override: NonNullable<PromptSettingsLayers["overrides"][string]>;
  isOutdated: boolean;
  error: string | undefined;
  autoFocus: boolean;
}): ReactElement {
  const { key } = template;
  const id = useId();
  const isOn = isPromptOverrideOn(override);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <LayerHeader
        label="Replacement prompt"
        htmlFor={id}
        description="This text replaces the built-in prompt. It does not get built-in updates."
        controls={
          <LayerControls
            switchLabel="Use override"
            checked={isOn}
            removeLabel="Remove override"
            disabled={disabled}
            onCheckedChange={(enabled) =>
              onUpdateLayers((current) => patchPromptOverride(current, key, { enabled }))
            }
            onRemove={() => onUpdateLayers((current) => removePromptOverride(current, key))}
          />
        }
      />
      <PromptTextField
        id={id}
        value={override.template}
        rows={10}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholders={template.placeholders}
        error={error}
        onChange={(text) =>
          onUpdateLayers((current) => patchPromptOverride(current, key, { template: text }))
        }
      />
      {/* The Outdated notice has its own built-in text button. */}
      {isOn && !isOutdated ? <BuiltinTextToggle text={template.template} /> : null}
    </section>
  );
}

function ReplaceRow({
  disabled,
  onReplace,
}: {
  disabled: boolean;
  onReplace: () => void;
}): ReactElement {
  return (
    <section className="flex flex-col items-start gap-3 rounded-md border border-border bg-card p-4 @xl/prompt-editor:flex-row @xl/prompt-editor:items-center @xl/prompt-editor:justify-between">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium text-foreground">Replace the whole prompt</h4>
        <p className="text-xs text-muted-foreground">
          Write the whole prompt yourself. A replaced prompt does not get built-in updates, so use
          append instructions when you can.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={disabled}
        onClick={onReplace}
      >
        Replace
      </Button>
    </section>
  );
}

/** What a change of the prompt affects: its workflow or its role, in one or every repository. */
const changeScope = (template: SettingsPromptTemplate, scope: PromptScope): string => {
  const repositories =
    scope.kind === "repository" ? "in this repository only" : "in every repository";
  return template.ownerKind === "workflow"
    ? `Your changes apply to every task of ${template.ownerTitle}, ${repositories}.`
    : `Your changes apply ${repositories}.`;
};

/** The editor of one prompt: append, override, and the final text preview. */
export function PromptLayerEditor({
  template,
  backTitle,
  onBack,
  scope,
  errors,
  disabled,
  onUpdateLayers,
}: PromptLayerEditorProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // An opened prompt starts at its top, not at the scroll position of the list. Its title
  // gets the focus from the row, which unmounts.
  useLayoutEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start" });
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  const { key } = template;
  const layers = scope.edited;
  const override = layers.overrides[key];
  const isOutdated = isPromptOverrideOutdated(override, template.builtinVersion);
  // A replacement that the user asks for gets the focus, so the user can type at once.
  const [hasReplaced, setHasReplaced] = useState(false);
  const { parts } = composePromptLayers(template.template, promptSettingsOfScope(scope), key);
  const sectionProps = { template, disabled, onUpdateLayers };
  const replace = (): void => {
    setHasReplaced(true);
    onUpdateLayers((current) =>
      replacePrompt(current, key, inheritedPromptText(template, scope), template.builtinVersion),
    );
  };

  return (
    <div ref={rootRef} className="@container/prompt-editor flex scroll-mt-4 flex-col gap-4 p-4">
      <PromptPageHeader
        backTitle={backTitle}
        title={template.label}
        titleRef={titleRef}
        aside={<PromptStatusBadges status={promptStatus(template, scope, errors)} />}
        onBack={onBack}
      >
        <p className="text-xs text-muted-foreground">
          {template.description ? `${template.description} ` : ""}
          {template.usage}. {changeScope(template, scope)}
        </p>
      </PromptPageHeader>
      {isOutdated ? <OutdatedNotice {...sectionProps} /> : null}
      <AppendSection {...sectionProps} append={layers.appends[key]} error={errors?.append} />
      {override ? (
        <OverrideSection
          {...sectionProps}
          override={override}
          isOutdated={isOutdated}
          error={errors?.override}
          autoFocus={hasReplaced}
        />
      ) : (
        <ReplaceRow disabled={disabled} onReplace={replace} />
      )}
      <PromptFinalText parts={parts} placeholders={template.placeholders} />
    </div>
  );
}
