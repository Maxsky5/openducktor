import { Eye, Palette } from "lucide-react";
import {
  workflowActionEmphasisSchema,
  workflowActionSurfaceSchema,
  workflowIconSchema,
  type WorkflowActionDefinition,
  type WorkflowLabelVariant,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { elementIds } from "../model/document-elements";
import { withOptional } from "../model/document-edits";
import { withActionKind } from "../model/create-elements";
import { ConditionField } from "./condition-builder";
import { iconOptions, vocabularyOptions } from "./element-options";
import { CheckboxGroupField } from "./choice-fields";
import { ItemList } from "./item-list";
import { ActionKindFields } from "./action-kind-fields";
import { SelectField } from "./reference-fields";
import { IdField, OptionalTextField, TextField } from "./text-fields";
import { useInspector } from "./inspector-context";
import { InspectorSection } from "./inspector-section";
import { MoreRules } from "./more-rules";
import { hasProblemUnder } from "./problem-paths";
import { useElementEdit } from "./use-element-edit";

const KIND_OPTIONS = vocabularyOptions(["event", "session", "view", "approval"] as const, {
  event: "Move the task",
  session: "Start an agent session",
  view: "Open a view",
  approval: "Open approval",
});
const SURFACES = workflowActionSurfaceSchema.options;
const SURFACE_DESCRIPTIONS = {
  kanban: "Board: the task card on the Kanban board",
  details: "Task details: the sheet that opens from a task card",
  studio: "Agent Studio: the agent session page",
  palette: "Command palette: Cmd+K on macOS, Ctrl+K on Windows and Linux",
} satisfies Record<(typeof SURFACES)[number], string>;
const SURFACE_OPTIONS = vocabularyOptions(SURFACES, {
  kanban: "Board",
  details: "Task details",
  studio: "Agent Studio",
  palette: "Command palette",
}).map((option) => ({ ...option, description: SURFACE_DESCRIPTIONS[option.value] }));

type Action = WorkflowActionDefinition;

const DISPLAY_ROOTS = ["description", "emphasis", "icon", "studioLabel", "labels", "id"] as const;

export function ActionInspector({ action }: { action: Action }): ReactElement {
  const { document, rename, problemPaths, change } = useInspector();
  const { edit, editText } = useElementEdit("action", action.id);
  const surfaces = action.surfaces ?? SURFACES;

  return (
    <>
      <InspectorSection>
        <TextField
          label="Name"
          path={["label"]}
          value={action.label}
          onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
        />
        <SelectField
          label="What it does"
          path={["kind"]}
          value={action.kind}
          options={KIND_OPTIONS}
          onChange={(kind) => kind && change((current) => withActionKind(current, action.id, kind))}
        />
        <ActionKindFields action={action} />
      </InspectorSection>

      <InspectorSection title="Where it shows" Icon={Eye} color="teal">
        <ConditionField
          label="Show when"
          path={["availableWhen"]}
          value={action.availableWhen}
          onChange={(availableWhen) => edit((current) => ({ ...current, availableWhen }))}
        />
        <CheckboxGroupField
          label="Show on"
          path={["surfaces"]}
          values={surfaces}
          options={SURFACE_OPTIONS}
          min={1}
          Icon={Eye}
          color="teal"
          onChange={(next) =>
            edit((current) =>
              withOptional(current, "surfaces", next.length === SURFACES.length ? undefined : next),
            )
          }
        />
      </InspectorSection>

      <MoreRules
        title="Display"
        Icon={Palette}
        color="slate"
        roots={DISPLAY_ROOTS}
        active={
          action.description !== undefined ||
          action.emphasis !== undefined ||
          action.icon !== undefined ||
          action.studioLabel !== undefined ||
          action.labels !== undefined ||
          hasProblemUnder(problemPaths, DISPLAY_ROOTS)
        }
      >
        <OptionalTextField
          label="Description"
          path={["description"]}
          multiline
          value={action.description}
          placeholder="Such as Starts the triage of the bug"
          onChange={(description) =>
            editText(["description"], (current) =>
              withOptional(current, "description", description),
            )
          }
        />
        <IdField
          path={["id"]}
          value={action.id}
          taken={elementIds(document, "action")}
          onCommit={(next) => rename("action", action.id, next)}
        />
        <SelectField
          label="Emphasis"
          path={["emphasis"]}
          value={action.emphasis ?? "neutral"}
          options={vocabularyOptions(workflowActionEmphasisSchema.options)}
          // Neutral is the default, so the document omits it.
          onChange={(emphasis) =>
            edit((current) =>
              withOptional(current, "emphasis", emphasis === "neutral" ? undefined : emphasis),
            )
          }
        />
        <SelectField
          label="Icon"
          path={["icon"]}
          value={action.icon}
          noneLabel="No icon"
          options={iconOptions(workflowIconSchema.options)}
          onChange={(icon) => edit((current) => withOptional(current, "icon", icon))}
        />
        <OptionalTextField
          label="Studio label"
          path={["studioLabel"]}
          value={action.studioLabel}
          onChange={(studioLabel) =>
            editText(["studioLabel"], (current) =>
              withOptional(current, "studioLabel", studioLabel),
            )
          }
        />
        <ItemList<WorkflowLabelVariant>
          label="Label variants: the first match replaces the label."
          path={["labels"]}
          items={action.labels ?? []}
          ordered
          addLabel="Add label variant"
          itemTitle={(variant, index) => variant.label || `Variant ${index + 1}`}
          create={() => ({ when: true, label: action.label })}
          onChange={(labels) =>
            edit((current) =>
              withOptional(current, "labels", labels.length > 0 ? labels : undefined),
            )
          }
          renderItem={(variant, index, update) => (
            <>
              <TextField
                label="Label"
                path={["labels", index, "label"]}
                value={variant.label}
                onChange={(label) => update({ ...variant, label })}
              />
              <ConditionField
                label="When"
                path={["labels", index, "when"]}
                value={variant.when}
                onChange={(when) => update({ ...variant, when })}
              />
            </>
          )}
        />
      </MoreRules>
    </>
  );
}
