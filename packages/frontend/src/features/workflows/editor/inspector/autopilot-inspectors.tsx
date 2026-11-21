import { Play, Radio } from "lucide-react";
import type {
  WorkflowAutomationDefinition,
  WorkflowSignalDefinition,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { elementIds } from "../model/document-elements";
import { withOptional } from "../model/document-edits";
import { SelectField } from "./reference-fields";
import { IdField, TextField } from "./text-fields";
import { useInspector } from "./inspector-context";
import { ChipsField } from "./toggle-chips";
import { InspectorSection } from "./inspector-section";
import { useElementEdit } from "./use-element-edit";
import { START_MODE_OPTIONS } from "./element-options";

export function SignalInspector({ signal }: { signal: WorkflowSignalDefinition }): ReactElement {
  const { document, rename, options } = useInspector();
  const { edit, editText } = useElementEdit("signal", signal.id);
  return (
    <InspectorSection title="Autopilot signal" Icon={Radio} color="fuchsia">
      <IdField
        path={["id"]}
        value={signal.id}
        taken={elementIds(document, "signal")}
        onCommit={(next) => rename("signal", signal.id, next)}
      />
      <TextField
        label="Name"
        path={["label"]}
        value={signal.label}
        onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
      />
      <TextField
        label="Description"
        path={["description"]}
        value={signal.description}
        multiline
        onChange={(description) =>
          editText(["description"], (current) => ({ ...current, description }))
        }
      />
      <ChipsField
        label="Automations it can start"
        hint="In the Autopilot settings, each person picks which of them start on this signal."
        emptyText="No automation yet. Add one under Advanced in the element list."
        Icon={Play}
        color="fuchsia"
        path={["automations"]}
        values={signal.automations}
        options={options.automations}
        onChange={(automations) => edit((current) => ({ ...current, automations }))}
      />
    </InspectorSection>
  );
}

export function AutomationInspector({
  automation,
}: {
  automation: WorkflowAutomationDefinition;
}): ReactElement {
  const { document, rename, options } = useInspector();
  const { edit, editText } = useElementEdit("automation", automation.id);
  return (
    <InspectorSection title="Autopilot automation" Icon={Play} color="fuchsia">
      <IdField
        path={["id"]}
        value={automation.id}
        taken={elementIds(document, "automation")}
        onCommit={(next) => rename("automation", automation.id, next)}
      />
      <TextField
        label="Name"
        path={["label"]}
        value={automation.label}
        onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
      />
      <TextField
        label="Description"
        path={["description"]}
        value={automation.description}
        multiline
        onChange={(description) =>
          editText(["description"], (current) => ({ ...current, description }))
        }
      />
      <SelectField
        label="Launch action"
        path={["launchActionId"]}
        value={automation.launchActionId}
        options={options.launchActionsWithPullRequest}
        onChange={(launchActionId) =>
          launchActionId && edit((current) => ({ ...current, launchActionId }))
        }
      />
      <SelectField
        label="Start mode"
        path={["startMode"]}
        value={automation.startMode}
        noneLabel="The default mode of the way to start"
        options={START_MODE_OPTIONS}
        onChange={(startMode) => edit((current) => withOptional(current, "startMode", startMode))}
      />
    </InspectorSection>
  );
}
