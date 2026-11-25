import { workflowIconSchema, type WorkflowRoleInput } from "@openducktor/contracts";
import { BASE_PROMPT_PLACEHOLDERS } from "@openducktor/workflows";
import { Fragment, type ReactElement, useId } from "react";
import { PromptTextField } from "@/components/features/settings/settings-prompt-text-field";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { iconOptions } from "../editor/inspector/element-options";
import { AccessFields, MoreRoleOptions, RoleField, ToolFields } from "./role-access-fields";

/** The icon of a role without one. */
const DEFAULT_ROLE_ICON = "agent";

/** What each placeholder of the role instructions fills in. */
const PLACEHOLDER_MEANINGS = [
  ["role", "the role ID, such as build"],
  ["role.allowedTools", "the OpenDucktor tools of the role"],
  ["task.id", "the task ID"],
  ["task.title", "the task title"],
  ["task.issueType", "the issue type ID: feature, bug, or task"],
  ["task.status", "the state ID of the task, such as in_progress"],
  ["task.description", "the task description"],
] as const satisfies readonly (readonly [(typeof BASE_PROMPT_PLACEHOLDERS)[number], string])[];

/** The placeholders that the instructions can use, each with what it fills in. */
function PlaceholderNote(): ReactElement {
  return (
    <span className="flex flex-col gap-1">
      <span>When a session starts, these placeholders fill in:</span>
      <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {PLACEHOLDER_MEANINGS.map(([name, meaning]) => (
          <Fragment key={name}>
            <code className="font-mono text-xs text-foreground">{`{{${name}}}`}</code>
            <span>{meaning}</span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

type RoleFormFieldsProps = {
  input: WorkflowRoleInput;
  onChange: (input: WorkflowRoleInput) => void;
  problems: ReadonlyMap<string, readonly string[]>;
  /** The ID is fixed after the first save. */
  idFixed: boolean;
  disabled: boolean;
};

/** The icon choices, each with its drawing. */
const ICON_OPTIONS = iconOptions(workflowIconSchema.options);

/**
 * Every field of a workflow role: the catalog role that workflows bind by ID. The usual fields
 * come first, with the ID beside the name, since it is fixed after the first save. More options
 * holds the icon, the side panel, and the runtime scopes.
 */
export function RoleFormFields({
  input,
  onChange,
  problems,
  idFixed,
  disabled,
}: RoleFormFieldsProps): ReactElement {
  const id = useId();
  const set = <Key extends keyof WorkflowRoleInput>(key: Key, value: WorkflowRoleInput[Key]) =>
    onChange({ ...input, [key]: value });
  const setOptional = <Key extends "icon" | "defaultPanel">(
    key: Key,
    value: WorkflowRoleInput[Key] | undefined,
  ) => {
    const next = { ...input };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const shared = { input, onChange, problems, disabled };
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <RoleField
          label="Name"
          labelId={`${id}-label`}
          controlId={`${id}-label-input`}
          problems={problems.get("label")}
        >
          <Input
            id={`${id}-label-input`}
            value={input.label}
            disabled={disabled}
            onChange={(event) => set("label", event.currentTarget.value)}
          />
        </RoleField>
        <RoleField
          label="Role ID"
          labelId={`${id}-id`}
          controlId={`${id}-id-input`}
          problems={problems.get("id")}
          hint={
            idFixed
              ? "The ID is fixed after the first save. Model defaults and prompt overrides use it."
              : "It comes from the name. You cannot change it after the first save."
          }
        >
          <Input
            id={`${id}-id-input`}
            value={input.id}
            readOnly={idFixed}
            disabled={disabled}
            className="font-mono text-xs"
            onChange={(event) => set("id", event.currentTarget.value)}
          />
        </RoleField>
      </div>
      <AccessFields {...shared} />
      <ToolFields {...shared} />
      <RoleField
        label="Instructions"
        labelId={`${id}-instructions`}
        controlId={`${id}-instructions-input`}
        problems={problems.get("instructions")}
        hint={<PlaceholderNote />}
      >
        <PromptTextField
          id={`${id}-instructions-input`}
          value={input.instructions}
          rows={10}
          disabled={disabled}
          placeholders={BASE_PROMPT_PLACEHOLDERS}
          error={undefined}
          onChange={(instructions) => set("instructions", instructions)}
        />
      </RoleField>
      <MoreRoleOptions {...shared}>
        <RoleField label="Icon" labelId={`${id}-icon`} problems={problems.get("icon")}>
          <Combobox
            // A role without an icon shows the Agent icon, so Agent stores nothing.
            value={input.icon ?? DEFAULT_ROLE_ICON}
            disabled={disabled}
            triggerAriaLabelledBy={`${id}-icon`}
            options={ICON_OPTIONS}
            onValueChange={(value) =>
              setOptional(
                "icon",
                workflowIconSchema.options.find(
                  (icon) => icon === value && icon !== DEFAULT_ROLE_ICON,
                ),
              )
            }
          />
        </RoleField>
        <RoleField
          label="Default side panel"
          labelId={`${id}-panel`}
          problems={problems.get("defaultPanel")}
        >
          <Combobox
            // A role without a side panel opens the document panel, so Document stores nothing.
            value={input.defaultPanel ?? "document"}
            searchable={false}
            disabled={disabled}
            triggerAriaLabelledBy={`${id}-panel`}
            options={[
              { value: "document", label: "Document" },
              { value: "diffs", label: "Diffs" },
            ]}
            onValueChange={(value) =>
              setOptional("defaultPanel", value === "diffs" ? value : undefined)
            }
          />
        </RoleField>
      </MoreRoleOptions>
    </div>
  );
}
