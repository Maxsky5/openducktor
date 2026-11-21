import { CheckCheck, CircleCheck, CircleX } from "lucide-react";
import type { WorkflowArtifactDefinition, WorkflowArtifactVerdict } from "@openducktor/contracts";

import type { ReactElement } from "react";
import { elementIds, eventRouteLabel } from "../model/document-elements";
import { addVerdict, withOptional } from "../model/document-edits";
import { SwitchField } from "./choice-fields";
import { ItemList } from "./item-list";
import { SelectField } from "./reference-fields";
import { IdField, OptionalTextField, TextField } from "./text-fields";
import { useInspector } from "./inspector-context";
import { InspectorSection } from "./inspector-section";
import { hasProblemUnder, MoreRules } from "./more-rules";
import { useElementEdit } from "./use-element-edit";

export function ArtifactInspector({
  artifact,
}: {
  artifact: WorkflowArtifactDefinition;
}): ReactElement {
  const { document, rename, options, problemPaths, create } = useInspector();
  const { edit, editText } = useElementEdit("artifact", artifact.id);
  /** Where a transition takes the task, such as "3 states → Human review". */
  const routeOf = (eventId: string) => {
    const event = document.definition.events.find(({ id }) => id === eventId);
    return event ? eventRouteLabel(document.definition, event) : undefined;
  };

  return (
    <>
      <InspectorSection>
        <TextField
          label="Name"
          path={["label"]}
          value={artifact.label}
          onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
        />
        <OptionalTextField
          label="Short label"
          path={["shortLabel"]}
          value={artifact.shortLabel}
          onChange={(shortLabel) =>
            editText(["shortLabel"], (current) => withOptional(current, "shortLabel", shortLabel))
          }
        />
        {artifact.kind === "document" ? (
          <>
            <SelectField
              label="Save moves with"
              path={["saveEventId"]}
              value={artifact.saveEventId}
              noneLabel="Nothing: a save changes only the document"
              options={options.events}
              onChange={(saveEventId) =>
                edit((current) =>
                  current.kind === "document"
                    ? withOptional(current, "saveEventId", saveEventId)
                    : current,
                )
              }
            />
            <OptionalTextField
              label="Starting text"
              path={["placeholder"]}
              value={artifact.placeholder}
              multiline
              hint="The text that the editor shows before anyone writes."
              onChange={(placeholder) =>
                editText(["placeholder"], (current) =>
                  current.kind === "document"
                    ? withOptional(current, "placeholder", placeholder)
                    : current,
                )
              }
            />
          </>
        ) : null}
      </InspectorSection>

      {artifact.kind === "review" ? (
        <InspectorSection title="Verdicts" Icon={CheckCheck} color="rose">
          <ItemList<WorkflowArtifactVerdict>
            path={["verdicts"]}
            items={artifact.verdicts}
            min={1}
            ordered
            addLabel="Add verdict"
            itemTitle={(verdict) => verdict.label || verdict.id}
            itemLeading={(verdict) =>
              verdict.passes ? (
                <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleX aria-hidden="true" className="size-4 shrink-0 text-rose-500" />
              )
            }
            onAdd={() => create((current) => addVerdict(current, artifact.id))}
            onChange={(verdicts) =>
              edit((current) => (current.kind === "review" ? { ...current, verdicts } : current))
            }
            renderItem={(verdict, index, update) => (
              <>
                <TextField
                  label="Name"
                  path={["verdicts", index, "label"]}
                  value={verdict.label}
                  onChange={(label) => update({ ...verdict, label })}
                />
                <SwitchField
                  label="Accepts the work"
                  path={["verdicts", index, "passes"]}
                  checked={verdict.passes}
                  onChange={(passes) => update({ ...verdict, passes })}
                />
                <SelectField
                  label="Moves with"
                  path={["verdicts", index, "eventId"]}
                  hint={routeOf(verdict.eventId)}
                  value={verdict.eventId}
                  options={options.events}
                  onChange={(eventId) => eventId && update({ ...verdict, eventId })}
                />
                <IdField
                  path={["verdicts", index, "id"]}
                  value={verdict.id}
                  taken={new Set(artifact.verdicts.map(({ id }) => id))}
                  onCommit={(next) =>
                    rename("verdict", `${artifact.id}/${verdict.id}`, `${artifact.id}/${next}`)
                  }
                />
              </>
            )}
          />
        </InspectorSection>
      ) : null}

      <MoreRules title="Advanced" active={hasProblemUnder(problemPaths, ["id"])} roots={["id"]}>
        <IdField
          path={["id"]}
          value={artifact.id}
          taken={elementIds(document, "artifact")}
          onCommit={(next) => rename("artifact", artifact.id, next)}
        />
      </MoreRules>
    </>
  );
}
