import type { WorkflowLaunchActionDefinition } from "@openducktor/contracts";
import { elementKey } from "@openducktor/workflows";
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { elementIds } from "../model/document-elements";
import { withOptional } from "../model/document-edits";
import { ConditionField } from "./condition-builder";
import { START_MODE_OPTIONS, vocabularyOptions } from "./element-options";
import { CheckboxGroupField, SwitchField } from "./choice-fields";
import { SelectField } from "./reference-fields";
import { IdField, OptionalTextField, RequiredTextField, TextField } from "./text-fields";
import { useInspector } from "./inspector-context";

type LaunchActionFieldsProps = {
  stepId: string;
  launch: WorkflowLaunchActionDefinition;
  index: number;
  update: (launch: WorkflowLaunchActionDefinition, typing?: boolean) => void;
  /** Renames the launch action, with its prompt while the prompt keeps the same name. */
  onLabelChange: (label: string) => void;
};

/** The fields of one launch action of an agent step. */
export function LaunchActionFields({
  launch,
  index,
  update,
  onLabelChange,
}: LaunchActionFieldsProps): ReactElement {
  const { document, rename, options, select, readOnly } = useInspector();
  const path = ["launchActions", index];
  const promptExists = document.prompts.some(({ id }) => id === launch.template.id);
  return (
    <>
      <TextField
        label="Name"
        path={[...path, "label"]}
        value={launch.label}
        onChange={onLabelChange}
      />
      <OptionalTextField
        label="Description"
        path={[...path, "description"]}
        multiline
        value={launch.description}
        onChange={(description) => update(withOptional(launch, "description", description), true)}
      />
      <CheckboxGroupField
        label="Start modes"
        path={[...path, "startModes"]}
        values={launch.startModes}
        options={START_MODE_OPTIONS}
        min={1}
        onChange={(startModes) =>
          update({
            ...launch,
            startModes,
            defaultStartMode: startModes.includes(launch.defaultStartMode)
              ? launch.defaultStartMode
              : startModes[0]!,
          })
        }
      />
      <SelectField
        label="Default mode"
        path={[...path, "defaultStartMode"]}
        value={launch.defaultStartMode}
        options={START_MODE_OPTIONS.filter(({ value }) => launch.startModes.includes(value))}
        onChange={(defaultStartMode) => defaultStartMode && update({ ...launch, defaultStartMode })}
      />
      <SelectField
        label="Prompt goes to"
        path={[...path, "template", "kind"]}
        value={launch.template.kind}
        options={vocabularyOptions(["kickoff", "message"] as const, {
          kickoff: "A new session",
          message: "The running session",
        })}
        onChange={(kind) => kind && update({ ...launch, template: { ...launch.template, kind } })}
      />
      <SelectField
        label="Prompt"
        path={[...path, "template", "id"]}
        value={launch.template.id}
        options={options.messagePrompts}
        hint={
          promptExists ? (
            <button
              type="button"
              className={LINK_BUTTON_CLASS}
              onClick={() => select(elementKey("prompt", launch.template.id))}
            >
              Open the prompt
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          ) : undefined
        }
        onChange={(id) => id && update({ ...launch, template: { ...launch.template, id } })}
      />
      <SelectField
        label="Asks the user"
        path={[...path, "context"]}
        value={launch.context}
        noneLabel="Nothing"
        options={vocabularyOptions(["human_feedback"] as const)}
        onChange={(context) => update(withOptional(launch, "context", context))}
      />
      <SwitchField
        label="Choose the target branch first"
        path={[...path, "targetBranch"]}
        checked={launch.targetBranch === true}
        onChange={(on) => update(withOptional(launch, "targetBranch", on || undefined))}
      />
      <SwitchField
        label="Autopilot needs a worktree"
        path={[...path, "requiresWorktree"]}
        checked={launch.requiresWorktree === true}
        onChange={(on) => update(withOptional(launch, "requiresWorktree", on || undefined))}
      />
      <SelectField
        label="Also shows in"
        path={[...path, "surface"]}
        value={launch.surface}
        noneLabel="Only the step"
        options={vocabularyOptions(["studio", "git_conflict"] as const, {
          studio: "Agent Studio",
          git_conflict: "Git conflict panel",
        })}
        onChange={(surface) => update(withOptional(launch, "surface", surface))}
      />
      <OptionalCondition
        label="Default when"
        path={[...path, "selectWhen"]}
        value={launch.selectWhen}
        readOnly={readOnly}
        onChange={(selectWhen) => update(withOptional(launch, "selectWhen", selectWhen))}
      />
      {launch.surface ? (
        <OptionalCondition
          label="Show the extra control when"
          path={[...path, "showWhen"]}
          value={launch.showWhen}
          readOnly={readOnly}
          onChange={(showWhen) => update(withOptional(launch, "showWhen", showWhen))}
        />
      ) : null}
      <SwitchField
        label="Offer Goal mode"
        path={[...path, "goal"]}
        checked={launch.goal !== undefined}
        hint="Goal mode also needs the Goal prompt, under Prompts."
        onChange={(on) =>
          update(
            withOptional(
              launch,
              "goal",
              on ? { defaultObjective: "Complete task {{task.id}}: {{task.title}}." } : undefined,
            ),
          )
        }
      />
      {launch.goal ? (
        <RequiredTextField
          label="Default goal"
          path={[...path, "goal", "defaultObjective"]}
          value={launch.goal.defaultObjective}
          multiline
          requiredMessage="Enter a default goal. Goal mode needs one."
          hint="It can use {{task.id}} and {{task.title}}."
          onChange={(defaultObjective) => update({ ...launch, goal: { defaultObjective } }, true)}
        />
      ) : null}
      <IdField
        path={[...path, "id"]}
        value={launch.id}
        taken={elementIds(document, "launchAction")}
        onCommit={(next) => rename("launchAction", launch.id, next)}
      />
    </>
  );
}

/** A condition that the element may omit. */
function OptionalCondition({
  label,
  path,
  value,
  onChange,
  hint,
  readOnly,
}: {
  label: string;
  path: (string | number)[];
  value: WorkflowLaunchActionDefinition["selectWhen"];
  onChange: (value: WorkflowLaunchActionDefinition["selectWhen"]) => void;
  hint?: string;
  readOnly: boolean;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <SwitchField
        label={`${label}: use a condition`}
        path={null}
        checked={value !== undefined}
        hint={hint}
        fixed={readOnly}
        onChange={(on) => onChange(on ? true : undefined)}
      />
      {value === undefined ? null : (
        <ConditionField label={label} path={path} value={value} onChange={onChange} />
      )}
    </div>
  );
}
