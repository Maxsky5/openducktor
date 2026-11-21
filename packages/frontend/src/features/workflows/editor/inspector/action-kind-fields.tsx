import type { WorkflowActionDefinition } from "@openducktor/contracts";
import { elementKey } from "@openducktor/workflows";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { addStep, stepOfLaunch, withOptional } from "../model/document-edits";
import { useInspector } from "./inspector-context";
import { IdListField, SelectField } from "./reference-fields";
import { useElementEdit } from "./use-element-edit";

type Action = WorkflowActionDefinition;

const TASK_DETAILS = "\u0000task-details";

/**
 * A link to the transition of an action. A transition that starts the work over says so, because
 * a click on the button then deletes code changes and sessions.
 */
function TransitionLink({ eventId }: { eventId: string }): ReactElement | null {
  const { document, select, catalogRoles } = useInspector();
  const event = document.definition.events.find(({ id }) => id === eventId);
  if (!event) return null;
  const reset = event.effects?.find(({ id }) => id === "worktree.reset");
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  const roles = (reset?.clearsSessionsOf ?? []).map((id) => roleLabels.get(id) ?? id);
  return (
    <div className="-mt-2 flex flex-col gap-2">
      {reset ? (
        <p className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-2.5 py-2 text-xs leading-5 text-rose-700 dark:text-rose-300">
          <RotateCcw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This transition resets the work. It deletes the code changes of the task
            {roles.length > 0 ? ` and the sessions of ${roles.join(", ")}` : ""}.
          </span>
        </p>
      ) : null}
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => select(elementKey("event", eventId))}
      >
        Open the transition
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The fields of one kind. A move or a session action names its transition and the agents it
 * starts. A session action takes the step of its first launch, so Agent Studio lists it there. A
 * view action opens the task details or the session of an agent step.
 */
export function ActionKindFields({ action }: { action: Action }): ReactElement | null {
  const { options, document } = useInspector();
  const { edit } = useElementEdit("action", action.id);
  if (action.kind === "approval") return null;
  if (action.kind === "view")
    return (
      <SelectField
        label="Opens"
        path={action.stepId === undefined ? ["target"] : ["stepId"]}
        value={action.stepId ?? TASK_DETAILS}
        options={[
          { value: TASK_DETAILS, label: "Task details" },
          ...options.agentSteps.map((step) => ({ ...step, label: `${step.label} session` })),
        ]}
        onChange={(choice) =>
          edit((current) => {
            if (current.kind !== "view") return current;
            const stepId = choice === TASK_DETAILS ? undefined : choice;
            return withOptional(withOptional(current, "target", undefined), "stepId", stepId);
          })
        }
      />
    );
  const moves = action.kind === "event";
  return (
    <>
      <SelectField
        label="Moves with"
        path={["eventId"]}
        value={action.eventId}
        options={options.events}
        {...(moves ? {} : { noneLabel: "Does not move the task" })}
        onChange={(eventId) =>
          edit((current) => {
            if (current.kind === "event") return eventId ? { ...current, eventId } : current;
            if (current.kind === "session") return withOptional(current, "eventId", eventId);
            return current;
          })
        }
      />
      {action.eventId ? <TransitionLink eventId={action.eventId} /> : null}
      <IdListField
        label={moves ? "Then starts" : "Starts"}
        path={["launchActionIds"]}
        values={action.launchActionIds ?? []}
        options={options.launchActions}
        min={moves ? 0 : 1}
        ordered
        addLabel="Add a way to start"
        hint={
          (action.launchActionIds ?? []).length > 1
            ? "The button uses the first way to start that fits the task."
            : undefined
        }
        emptyText={options.launchActions.length === 0 ? <NoAgentStep /> : "No agent starts."}
        onChange={(launchActionIds) =>
          edit((current) => {
            if (current.kind === "session")
              return withOptional(
                { ...current, launchActionIds },
                "stepId",
                stepOfLaunch(document, launchActionIds[0]),
              );
            if (current.kind === "event")
              return withOptional(
                current,
                "launchActionIds",
                launchActionIds.length > 0 ? launchActionIds : undefined,
              );
            return current;
          })
        }
      />
    </>
  );
}

/** No agent step exists yet: an inline link adds one and selects it. */
function NoAgentStep(): ReactElement {
  const { create, options, readOnly } = useInspector();
  const roleId = options.firstRole;
  return (
    <>
      No agent step exists yet.{" "}
      {readOnly || roleId === undefined ? null : (
        <button
          type="button"
          // The link style of the outline "Settings" link: the brand colour, underlined on hover.
          className="rounded-sm font-medium text-(--workflow-selection) underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() =>
            create((current) => addStep(current, "Agent step", { kind: "agent", roleId }))
          }
        >
          Add an agent step
        </button>
      )}
    </>
  );
}
