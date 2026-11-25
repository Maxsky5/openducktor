import type {
  WorkflowAgentEvent,
  WorkflowDocument,
  WorkflowEventDefinition,
} from "@openducktor/contracts";
import { Bot, ChevronRight, Plus } from "lucide-react";
import { type ReactElement, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { addBoardButton } from "../model/create-elements";
import { bindRole, updateElement, withOptional } from "../model/document-edits";
import { eventSenders, SENDER_KIND_TEXT, senderText } from "../model/event-senders";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { IconTile } from "../kind-theme";
import { roleIconsOf, senderLook } from "../sender-icon";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { SwitchField } from "./choice-fields";
import { ChipsField } from "./toggle-chips";
import { RequiredTextField } from "./text-fields";
import { useElementEdit } from "./use-element-edit";

/** The transition with agent sending on for one role, with a description for the role prompt. */
const withAgentSending = (
  event: WorkflowEventDefinition,
  roleId: string,
): WorkflowEventDefinition => ({
  ...event,
  agent: {
    roles: [roleId],
    description: "Send it when your work on the task is done.",
    note: "optional",
  },
});

/** The buttons, saves, verdicts, and step starts that send the transition. A click opens one. */
function BoardButtons({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { document, readOnly, change, select, catalogRoles } = useInspector();
  const roleLabels = useMemo(
    () => new Map(catalogRoles.map(({ role }) => [role.id, role.label])),
    [catalogRoles],
  );
  const roleIcons = useMemo(() => roleIconsOf(catalogRoles), [catalogRoles]);
  // Agents show in their own block below.
  const triggers = (eventSenders(document.definition).get(event.id) ?? []).filter(
    ({ kind }) => kind !== "agent",
  );
  return (
    <div className="flex flex-col gap-2">
      {triggers.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {triggers.map((sender) => {
            const text = senderText(sender, roleLabels);
            const key = sender.key;
            return (
              <li key={`${sender.kind}:${sender.label}`}>
                <button
                  type="button"
                  disabled={key === null}
                  title={`Open ${text}`}
                  className="group flex min-w-0 items-center gap-2.5 -mx-1.5 w-[calc(100%+0.75rem)] rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
                  onClick={() => key && select(key)}
                >
                  <IconTile {...senderLook(sender, roleIcons)} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{text}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {SENDER_KIND_TEXT[sender.kind]}
                    </span>
                  </span>
                  {key === null ? null : (
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {readOnly ? null : (
        <button
          type="button"
          className={LINK_BUTTON_CLASS}
          onClick={() => change((current) => addBoardButton(current, event))}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add a button
        </button>
      )}
    </div>
  );
}

/** What the Agents switch does, with the names of the roles that can move the task. */
const agentsHint = (noRole: boolean, names: readonly string[]): string => {
  if (noRole) return "Pick the agent that moves the task when its work is done.";
  if (names.length === 0) return "An agent moves the task when its work is done.";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  return `${who} can move the task when its work is done.`;
};

/** The tool that lets an agent move the task. A role without it cannot send a transition. */
const MOVE_TOOL = "odt_apply_workflow_event";

/** The roles of the host that can move a task, so an agent pick never raises a problem. */
const useMovers = () => {
  const { catalogRoles } = useInspector();
  return useMemo(
    () => catalogRoles.filter(({ role }) => role.tools.some((tool) => tool === MOVE_TOOL)),
    [catalogRoles],
  );
};

/** Adds the roles that the workflow does not have yet, so they can send the transition. */
const withRoles = (document: WorkflowDocument, roles: readonly string[]): WorkflowDocument => {
  const bound = new Set(document.definition.roles.map(({ id }) => id));
  return roles
    .filter((role) => !bound.has(role))
    .reduce((current, role) => bindRole(current, role).document, document);
};

/**
 * The agent picker of a transition without agents, while the workflow has no role that can move
 * the task. A pick adds the role to the workflow and lets it send the transition, in one undo
 * step.
 */
function PickAgentRole({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { change } = useInspector();
  const movers = useMovers();
  const [open, setOpen] = useState(false);
  return (
    <Combobox
      value=""
      open={open}
      onOpenChange={setOpen}
      options={movers.map(({ role, source }) => ({
        value: role.id,
        label: role.label,
        secondaryLabel: source === "builtin" ? "Built-in" : "Custom",
      }))}
      searchPlaceholder="Search agents"
      listLabel="Agents"
      emptyText="No agent found."
      footer={
        <p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">
          Only agents that can move the task show here.
        </p>
      }
      onValueChange={(roleId) =>
        change((document) =>
          updateElement(withRoles(document, [roleId]), "event", event.id, (current) =>
            withAgentSending(current, roleId),
          ),
        )
      }
      className="w-64"
      trigger={
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Pick an agent"
          className="h-7 shrink-0 gap-1 px-2"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Pick
        </Button>
      }
    />
  );
}

/** Whether agents can send the transition, which roles, and what their instructions say. */
function AgentTrigger({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { options, readOnly, change } = useInspector();
  const { edit, editText } = useElementEdit("event", event.id);
  const switchId = useId();
  const agent = event.agent;
  const movers = useMovers();
  const moverIds = new Set(movers.map(({ role }) => role.id));
  const boundIds = new Set(options.boundRoles.map(({ value }) => value));
  // The role that an outcome names as its cause sends the transition first, such as Builder.
  const firstRole =
    event.outcomes.map(({ sourceRole }) => sourceRole).find((role) => role && moverIds.has(role)) ??
    options.boundRoles.find(({ value }) => moverIds.has(value))?.value;
  const noRole = agent === undefined && firstRole === undefined;
  const roleLabels = new Map(options.boundRoles.map(({ value, label }) => [value, label]));
  const agentNames = (agent?.roles ?? []).map((role) => roleLabels.get(role) ?? role);
  const editAgent = (update: (value: WorkflowAgentEvent) => WorkflowAgentEvent) =>
    edit((current) => (current.agent ? { ...current, agent: update(current.agent) } : current));
  // Every role that can move the task, the roles of the workflow first, and the picked ones, so
  // a wrong pick can still go. A role of another group joins the workflow when the user picks it.
  const agentOptions = [
    ...movers
      .filter(({ role }) => boundIds.has(role.id))
      .map(({ role }) => ({ value: role.id, label: role.label, group: "In this workflow" })),
    ...(agent?.roles ?? [])
      .filter((role) => !moverIds.has(role))
      .map((role) => ({
        value: role,
        label: roleLabels.get(role) ?? role,
        group: "In this workflow",
      })),
    ...movers
      .filter(({ role }) => !boundIds.has(role.id))
      .map(({ role }) => ({ value: role.id, label: role.label, group: "Adds to the workflow" })),
  ];
  return (
    <div data-field-path={fieldPathAttribute(["agent"])} className="flex flex-col gap-4">
      {/* A plain row, lined up with the board buttons above it. */}
      <div className="-mx-1.5 flex items-start gap-2.5 px-1.5 py-1.5">
        <IconTile Icon={Bot} color="emerald" size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <Label htmlFor={switchId} className="text-sm font-medium">
            Agents
          </Label>
          <span className="text-xs leading-5 text-muted-foreground">
            {agentsHint(noRole, agentNames)}
          </span>
        </span>
        {noRole && !readOnly ? (
          <PickAgentRole event={event} />
        ) : (
          <Switch
            id={switchId}
            className="mt-1"
            checked={agent !== undefined}
            disabled={readOnly || noRole}
            onCheckedChange={(on) =>
              edit((current) =>
                on && firstRole
                  ? withAgentSending(current, firstRole)
                  : withOptional(current, "agent", undefined),
              )
            }
          />
        )}
      </div>
      {agent ? (
        <div className="ml-3 flex flex-col gap-4 border-l-2 border-emerald-500/40 pl-3">
          <ChipsField
            label="Which agents"
            Icon={Bot}
            color="emerald"
            path={["agent", "roles"]}
            values={agent.roles}
            options={agentOptions}
            min={1}
            // A new pick adds its role to the workflow in the same undo step.
            onChange={(roles) =>
              change((document) =>
                updateElement(withRoles(document, roles), "event", event.id, (current) =>
                  current.agent ? { ...current, agent: { ...current.agent, roles } } : current,
                ),
              )
            }
          />
          <RequiredTextField
            label="When to use it"
            path={["agent", "description"]}
            value={agent.description}
            multiline
            hint="Such as: Send when the fix is done."
            requiredMessage="Tell the agent when to use this transition."
            onChange={(description) =>
              editText(["agent", "description"], (current) =>
                current.agent ? { ...current, agent: { ...current.agent, description } } : current,
              )
            }
          />
          <SwitchField
            label="The agent must give a reason"
            path={["agent", "note"]}
            checked={agent.note === "required"}
            onChange={(required) =>
              editAgent((current) => ({ ...current, note: required ? "required" : "optional" }))
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What can move a task with the transition: buttons and agents. A problem about the whole
 * transition, such as one that nothing triggers, focuses this section.
 */
export function EventSendersField({ event }: { event: WorkflowEventDefinition }): ReactElement {
  return (
    <div data-field-path={fieldPathAttribute([])} className="flex flex-col gap-5">
      <BoardButtons event={event} />
      <AgentTrigger event={event} />
    </div>
  );
}
