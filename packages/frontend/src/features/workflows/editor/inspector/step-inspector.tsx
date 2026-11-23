import {
  workflowSessionActivitySchema,
  type WorkflowStepDefinition,
  type WorkflowStepDisplayRule,
} from "@openducktor/contracts";
import { FileText, Play, Plus, Timer } from "lucide-react";
import type { ReactElement } from "react";
import { elementIds } from "../model/document-elements";
import {
  addLaunchAction,
  renameLaunchAction,
  updateElement,
  withOptional,
} from "../model/document-edits";
import { ConditionField } from "./condition-builder";
import { vocabularyOptions } from "./element-options";
import { CheckboxGroupField } from "./choice-fields";
import { ItemList } from "./item-list";
import { SelectField } from "./reference-fields";
import { IdField, TextField } from "./text-fields";
import { fieldCoalesceKey, useInspector } from "./inspector-context";
import { ChipsField } from "./toggle-chips";
import { InspectorSection } from "./inspector-section";
import { LaunchActionFields } from "./launch-action-fields";
import { MoreRules, RuleGroup } from "./more-rules";
import { hasProblemUnder } from "./problem-paths";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { useElementEdit } from "./use-element-edit";

const SESSION_OPTIONS = vocabularyOptions(workflowSessionActivitySchema.options, {
  waiting_input: "Waiting for input",
});

/** The first parts of the field paths under Advanced. */
const ADVANCED_ROOTS = ["id", "startEventId", "displayRules"] as const;

export function StepInspector({ step }: { step: WorkflowStepDefinition }): ReactElement {
  const { document, rename, options, change, elementKey, readOnly, problemPaths } = useInspector();
  const { edit, editText } = useElementEdit("step", step.id);
  const conditions = [
    ["requiredWhen", "Needed when", "When this is false, the task skips the step."],
    ["availableWhen", "Can start when", "The step offers its start only while this is true."],
    ["completedWhen", "Done when", "The step counts as done once this is true."],
  ] as const;
  const advancedActive =
    (step.kind === "agent" &&
      (step.startEventId !== undefined || step.displayRules !== undefined)) ||
    hasProblemUnder(problemPaths, ADVANCED_ROOTS);

  return (
    <>
      <InspectorSection>
        <TextField
          label="Name"
          path={["label"]}
          value={step.label}
          onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
        />
        {step.kind === "agent" ? (
          <SelectField
            label="Agent role"
            path={["roleId"]}
            value={step.roleId}
            options={options.boundRoles}
            onChange={(roleId) =>
              roleId &&
              edit((current) => (current.kind === "agent" ? { ...current, roleId } : current))
            }
          />
        ) : (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
            A person does this step. No agent starts for it.
          </p>
        )}
        <ChipsField
          label="Reads"
          emptyText="No artifact yet. Add one under Artifacts in the element list."
          Icon={FileText}
          color="rose"
          path={["inputs"]}
          values={step.inputs}
          options={options.artifacts}
          onChange={(inputs) => edit((current) => ({ ...current, inputs }))}
        />
        <ChipsField
          label="Writes"
          emptyText="No artifact yet. Add one under Artifacts in the element list."
          Icon={FileText}
          color="rose"
          path={["outputs"]}
          values={step.outputs}
          options={options.artifacts}
          onChange={(outputs) => edit((current) => ({ ...current, outputs }))}
        />
      </InspectorSection>

      <InspectorSection title="When it runs" Icon={Timer} color="indigo">
        {conditions.map(([field, label, hint]) => (
          <ConditionField
            key={field}
            label={label}
            path={[field]}
            value={step[field]}
            hint={hint}
            onChange={(value) => edit((current) => ({ ...current, [field]: value }))}
          />
        ))}
      </InspectorSection>

      {step.kind === "agent" ? (
        <>
          <InspectorSection title="Ways to start" Icon={Play} color="indigo">
            <ItemList
              path={["launchActions"]}
              items={step.launchActions}
              min={1}
              ordered
              itemTitle={(launch) => launch.label || launch.id}
              onChange={(launchActions) =>
                edit((current) =>
                  current.kind === "agent" ? { ...current, launchActions } : current,
                )
              }
              renderItem={(launch, index) => (
                <LaunchActionFields
                  stepId={step.id}
                  launch={launch}
                  index={index}
                  update={(next, typing) =>
                    change(
                      (current) =>
                        updateElement(current, "step", step.id, (item) =>
                          item.kind === "agent"
                            ? {
                                ...item,
                                launchActions: item.launchActions.map((candidate, other) =>
                                  other === index ? next : candidate,
                                ),
                              }
                            : item,
                        ),
                      typing
                        ? { coalesceKey: fieldCoalesceKey(elementKey, ["launchActions", index]) }
                        : {},
                    )
                  }
                  onLabelChange={(label) =>
                    change((current) => renameLaunchAction(current, launch.id, label), {
                      coalesceKey: fieldCoalesceKey(elementKey, ["launchActions", index, "label"]),
                    })
                  }
                />
              )}
            />
            {readOnly ? null : (
              <button
                type="button"
                className={LINK_BUTTON_CLASS}
                onClick={() =>
                  change((current) =>
                    addLaunchAction(current, step.id, `Continue ${step.label || step.id}`),
                  )
                }
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Add a way to start
              </button>
            )}
          </InspectorSection>
        </>
      ) : null}

      <MoreRules title="Advanced" active={advancedActive} roots={ADVANCED_ROOTS}>
        <IdField
          path={["id"]}
          value={step.id}
          taken={elementIds(document, "step")}
          onCommit={(next) => rename("step", step.id, next)}
        />
        {step.kind === "agent" ? (
          <>
            <SelectField
              label="Start transition"
              path={["startEventId"]}
              value={step.startEventId}
              noneLabel="None"
              options={options.events}
              onChange={(startEventId) =>
                edit((current) =>
                  current.kind === "agent"
                    ? withOptional(current, "startEventId", startEventId)
                    : current,
                )
              }
            />
            <RuleGroup
              title="Progress display"
              help="How the task card shows the progress of this step. The first matching rule decides."
            >
              <ItemList<WorkflowStepDisplayRule>
                path={["displayRules"]}
                items={step.displayRules ?? []}
                ordered
                addLabel="Add display rule"
                itemTitle={(_, index) => `Rule ${index + 1}`}
                create={() => ({ when: true })}
                onChange={(displayRules) =>
                  edit((current) =>
                    current.kind === "agent"
                      ? withOptional(
                          current,
                          "displayRules",
                          displayRules.length > 0 ? displayRules : undefined,
                        )
                      : current,
                  )
                }
                renderItem={(rule, index, update) => (
                  <>
                    <ConditionField
                      label="When"
                      path={["displayRules", index, "when"]}
                      value={rule.when}
                      onChange={(when) => update({ ...rule, when })}
                    />
                    <CheckboxGroupField
                      label="Session of the step role"
                      path={["displayRules", index, "session"]}
                      values={rule.session ?? []}
                      options={SESSION_OPTIONS}
                      hint="Without a choice, any session matches."
                      onChange={(session) =>
                        update(
                          withOptional(rule, "session", session.length > 0 ? session : undefined),
                        )
                      }
                    />
                    <SelectField
                      label="Completion"
                      path={["displayRules", index, "completion"]}
                      value={rule.completion}
                      noneLabel="Not set by this rule"
                      options={vocabularyOptions([
                        "not_started",
                        "in_progress",
                        "done",
                        "rejected",
                      ] as const)}
                      onChange={(completion) =>
                        update(withOptional(rule, "completion", completion))
                      }
                    />
                    <SelectField
                      label="Attention"
                      path={["displayRules", index, "attention"]}
                      value={rule.attention}
                      noneLabel="Not set by this rule"
                      options={vocabularyOptions(["none", "needs_input"] as const)}
                      onChange={(attention) => update(withOptional(rule, "attention", attention))}
                    />
                  </>
                )}
              />
            </RuleGroup>
          </>
        ) : null}
      </MoreRules>
    </>
  );
}
