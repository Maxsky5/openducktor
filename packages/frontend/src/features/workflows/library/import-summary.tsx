import type { WorkflowImportPreview } from "@openducktor/contracts";
import { type ReactElement, useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type ReadyPreview = Extract<WorkflowImportPreview, { outcome: "ready" }>;
export type Target = "new" | "update";
export type RoleChoice = "host" | "new";

export const invalidLocation = (
  preview: Extract<WorkflowImportPreview, { outcome: "invalid" }>,
) => {
  if (preview.line === null) return "";
  return preview.column === null
    ? ` (line ${preview.line})`
    : ` (line ${preview.line}, column ${preview.column})`;
};

function ChoiceGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  disabled: boolean;
}): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        aria-labelledby={id}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const choice = options.find((option) => option.value === next);
          if (choice) onChange(choice.value);
        }}
        className="flex flex-col gap-2"
      >
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={option.value} />
            {option.label}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** The summary of a readable file and the choices that its import needs. */
export function ImportSummary({
  preview,
  target,
  onTarget,
  roleChoices,
  onRoleChoice,
  replaceConfirmed,
  onReplaceConfirmed,
  disabled,
}: {
  preview: ReadyPreview;
  target: Target;
  onTarget: (target: Target) => void;
  roleChoices: Readonly<Record<string, RoleChoice>>;
  onRoleChoice: (roleId: string, choice: RoleChoice) => void;
  replaceConfirmed: boolean;
  onReplaceConfirmed: (confirmed: boolean) => void;
  disabled: boolean;
}): ReactElement {
  const created = preview.roles.filter(({ status }) => status === "create");
  const reused = preview.roles.filter(({ status }) => status === "reuse");
  const conflicts = preview.roles.filter(({ status }) => status === "conflict");
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Workflow</dt>
        <dd>{preview.name}</dd>
        <dt className="text-muted-foreground">ID in the file</dt>
        <dd className="font-mono text-xs">{preview.workflowId}</dd>
        <dt className="text-muted-foreground">Result</dt>
        <dd>
          {target === "update"
            ? "Update: the content becomes its draft"
            : "A new workflow with an unpublished draft"}
        </dd>
      </dl>
      {preview.match === "custom" ? (
        <ChoiceGroup<Target>
          label={`You already have workflow "${preview.workflowId}".`}
          value={target}
          disabled={disabled}
          onChange={onTarget}
          options={[
            { value: "update", label: "Update that workflow" },
            { value: "new", label: "Import as a new workflow copy" },
          ]}
        />
      ) : null}
      {preview.match === "builtin" ? (
        <p className="text-sm text-muted-foreground">
          The file has the built-in workflow ID, so the import creates a new workflow with a new ID.
        </p>
      ) : null}
      {target === "update" && preview.existingDraft ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={replaceConfirmed}
            disabled={disabled}
            onCheckedChange={(checked) => onReplaceConfirmed(checked === true)}
          />
          The workflow has a draft. Replace the existing draft with the file content.
        </label>
      ) : null}
      {created.length > 0 ? (
        <p className="text-sm">
          New roles:{" "}
          <span className="font-mono text-xs">{created.map(({ id }) => id).join(", ")}</span>
        </p>
      ) : null}
      {reused.length > 0 ? (
        <p className="text-sm">
          Roles that you already have, with the same content:{" "}
          <span className="font-mono text-xs">{reused.map(({ id }) => id).join(", ")}</span>
        </p>
      ) : null}
      {conflicts.map(({ id }) => (
        <ChoiceGroup<RoleChoice>
          key={id}
          label={`Role "${id}" differs from your role with this ID.`}
          value={roleChoices[id] ?? "host"}
          disabled={disabled}
          onChange={(choice) => onRoleChoice(id, choice)}
          options={[
            { value: "host", label: "Keep your role" },
            { value: "new", label: "Import as a new role with a new ID" },
          ]}
        />
      ))}
      <Alert variant="warning" role="note">
        <div>
          <AlertTitle>Read the prompts before you publish</AlertTitle>
          <AlertDescription>
            Imported prompts and role instructions instruct agents. The import never publishes the
            workflow.
          </AlertDescription>
        </div>
      </Alert>
    </div>
  );
}
