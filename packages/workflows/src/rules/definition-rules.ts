import {
  PULL_REQUEST_LAUNCH_ID,
  TASK_CLOSED_STATE,
  TASK_OPEN_STATE,
  type WorkflowDefinition,
  type WorkflowProblemPath,
} from "@openducktor/contracts";
import { PULL_REQUEST_LAUNCH } from "../task-workflow/pull-request-launch";
import { createConditionCheck, declaredFacts } from "./condition-rules";
import type { ProblemSink } from "./problems";

/** A definition as the rules read it. A compiled definition is a readonly copy. */
export type RuleDefinition = Pick<
  WorkflowDefinition,
  | "id"
  | "facts"
  | "issueTypes"
  | "defaultIssueType"
  | "roles"
  | "pullRequestRoles"
  | "artifacts"
  | "states"
  | "steps"
  | "actions"
  | "events"
  | "signals"
  | "automations"
  | "actionOrder"
  | "actionPriority"
  | "launchOrder"
>;

/** The singular and plural name of each collection in problem messages, in editor words. */
const KIND_NAMES = {
  facts: ["fact", "facts"],
  issueTypes: ["issue type", "issue types"],
  roles: ["role", "roles"],
  artifacts: ["artifact", "artifacts"],
  states: ["state", "states"],
  steps: ["step", "steps"],
  events: ["transition", "transitions"],
  actions: ["button", "buttons"],
  signals: ["Autopilot signal", "Autopilot signals"],
  automations: ["automation", "automations"],
  "launch actions": ["way to start", "ways to start"],
  verdicts: ["verdict", "verdicts"],
  guards: ["requirement", "requirements"],
} as const;
type Collection = keyof typeof KIND_NAMES;

/** The name that the editor shows for an element: its label, or its ID without one. */
const nameOf = (item: { readonly id: string; readonly label?: string | undefined }): string =>
  item.label || item.id;

/**
 * Collects every structural problem of a workflow definition: unique IDs, declared references,
 * core states, start modes, and the rules of actions, effects, and automations. The paths are
 * relative to the definition.
 */
export const collectDefinitionProblems = (definition: RuleDefinition, sink: ProblemSink): void => {
  const error = sink.error;
  const checkCondition = createConditionCheck(definition, error);
  const checkIds = (
    items: readonly { id: string }[],
    collection: Collection,
    path: WorkflowProblemPath,
    owner?: string,
    result = new Set<string>(),
  ): Set<string> => {
    const plural = KIND_NAMES[collection][1];
    items.forEach((item, index) => {
      if (result.has(item.id))
        error(
          [...path, index, "id"],
          owner === undefined
            ? `Two ${plural} have the ID "${item.id}". Change one ID.`
            : `${owner} has two ${plural} with the ID "${item.id}". Change one ID.`,
        );
      result.add(item.id);
    });
    return result;
  };
  const checkReference = (
    id: string,
    known: ReadonlySet<string>,
    collection: Collection,
    path: WorkflowProblemPath,
    owner: string,
  ) => {
    const kind = KIND_NAMES[collection][0];
    if (!known.has(id))
      error(path, `${owner} uses the missing ${kind} "${id}". Add it or pick another ${kind}.`);
  };

  checkIds(declaredFacts(definition), "facts", ["facts"]);
  const issueTypes = checkIds(definition.issueTypes, "issueTypes", ["issueTypes"]);
  if (definition.defaultIssueType !== undefined)
    checkReference(
      definition.defaultIssueType,
      issueTypes,
      "issueTypes",
      ["defaultIssueType"],
      "The default type",
    );
  const roles = checkIds(definition.roles, "roles", ["roles"]);
  const artifacts = checkIds(definition.artifacts, "artifacts", ["artifacts"]);
  const states = checkIds(definition.states, "states", ["states"]);
  const steps = checkIds(definition.steps, "steps", ["steps"]);
  const events = checkIds(definition.events, "events", ["events"]);
  const actions = checkIds(definition.actions, "actions", ["actions"]);
  const signals = checkIds(definition.signals, "signals", ["signals"]);
  const automations = checkIds(definition.automations, "automations", ["automations"]);
  const launchActions = new Set<string>();
  definition.steps.forEach((step, index) => {
    if (step.kind !== "agent") return;
    checkIds(
      step.launchActions,
      "launch actions",
      ["steps", index, "launchActions"],
      undefined,
      launchActions,
    );
    step.launchActions.forEach((launch, launchIndex) => {
      if (launch.id === PULL_REQUEST_LAUNCH_ID)
        error(
          ["steps", index, "launchActions", launchIndex, "id"],
          `Way to start "${nameOf(launch)}" cannot use the ID "${PULL_REQUEST_LAUNCH_ID}", because OpenDucktor keeps it for pull requests. Use another ID.`,
        );
    });
  });
  // Automations and launch order rules can also name the core pull request launch.
  const startableLaunches = new Set([...launchActions, PULL_REQUEST_LAUNCH_ID]);

  for (const core of [TASK_OPEN_STATE, TASK_CLOSED_STATE])
    if (!states.has(core))
      error(["states"], `Every workflow needs a state with the ID "${core}". Add it.`);
  definition.pullRequestRoles.forEach((id, index) =>
    checkReference(id, roles, "roles", ["pullRequestRoles", index], "The pull request role list"),
  );
  definition.roles.forEach((role, index) => {
    const owner = `Role "${role.id}"`;
    role.writes.forEach((id, writeIndex) =>
      checkReference(id, artifacts, "artifacts", ["roles", index, "writes", writeIndex], owner),
    );
    if (role.defaultArtifact !== undefined)
      checkReference(
        role.defaultArtifact,
        artifacts,
        "artifacts",
        ["roles", index, "defaultArtifact"],
        owner,
      );
  });
  definition.artifacts.forEach((artifact, index) => {
    const path = ["artifacts", index];
    const owner = `${artifact.kind === "document" ? "Document" : "Review"} "${nameOf(artifact)}"`;
    if (artifact.kind === "document") {
      if (artifact.saveEventId !== undefined)
        checkReference(artifact.saveEventId, events, "events", [...path, "saveEventId"], owner);
      return;
    }
    checkIds(artifact.verdicts, "verdicts", [...path, "verdicts"], owner);
    artifact.verdicts.forEach((verdict, verdictIndex) =>
      checkReference(
        verdict.eventId,
        events,
        "events",
        [...path, "verdicts", verdictIndex, "eventId"],
        `Verdict "${nameOf(verdict)}" of review "${nameOf(artifact)}"`,
      ),
    );
  });
  // One notification kind is one settings key, so it can have only one default setting.
  const notificationDefaults = new Map<string, { stateName: string; encoded: string }>();
  definition.states.forEach((state, index) => {
    const path = ["states", index];
    const owner = `State "${nameOf(state)}"`;
    const notification = state.notification;
    if (notification) {
      const encoded = JSON.stringify(notification.defaultSetting);
      const first = notificationDefaults.get(notification.kind);
      if (!first)
        notificationDefaults.set(notification.kind, { stateName: nameOf(state), encoded });
      else if (first.encoded !== encoded)
        error(
          [...path, "notification", "defaultSetting"],
          `${owner} sends the "${notification.kind}" notification with other defaults than state "${first.stateName}". Give both the same defaults, or send another notification.`,
        );
    }
    if (state.notification?.role !== undefined)
      checkReference(
        state.notification.role,
        roles,
        "roles",
        [...path, "notification", "role"],
        owner,
      );
    if (state.studioRole !== undefined)
      checkReference(state.studioRole, roles, "roles", [...path, "studioRole"], owner);
    state.historyRoles?.forEach((id, roleIndex) =>
      checkReference(id, roles, "roles", [...path, "historyRoles", roleIndex], owner),
    );
  });
  definition.steps.forEach((step, index) => {
    const path = ["steps", index];
    const owner = `Step "${nameOf(step)}"`;
    step.inputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", [...path, "inputs", artifactIndex], owner),
    );
    step.outputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", [...path, "outputs", artifactIndex], owner),
    );
    checkCondition(
      step.requiredWhen,
      [...path, "requiredWhen"],
      `The "Needed when" condition of step "${nameOf(step)}"`,
    );
    checkCondition(
      step.availableWhen,
      [...path, "availableWhen"],
      `The "Can start when" condition of step "${nameOf(step)}"`,
    );
    checkCondition(
      step.completedWhen,
      [...path, "completedWhen"],
      `The "Done when" condition of step "${nameOf(step)}"`,
    );
    if (step.kind !== "agent") return;
    checkReference(step.roleId, roles, "roles", [...path, "roleId"], owner);
    if (step.startEventId !== undefined)
      checkReference(step.startEventId, events, "events", [...path, "startEventId"], owner);
    step.launchActions.forEach((launch, launchIndex) => {
      const launchPath = [...path, "launchActions", launchIndex];
      const launchOwner = `Way to start "${nameOf(launch)}"`;
      if (!launch.startModes.includes(launch.defaultStartMode))
        error(
          [...launchPath, "defaultStartMode"],
          `${launchOwner} has the default mode "${launch.defaultStartMode}", which is not one of its start modes. Add it to the start modes or pick another default mode.`,
        );
      if (launch.selectWhen !== undefined)
        checkCondition(
          launch.selectWhen,
          [...launchPath, "selectWhen"],
          `The "Default when" condition of way to start "${nameOf(launch)}"`,
        );
      if (launch.showWhen !== undefined)
        checkCondition(
          launch.showWhen,
          [...launchPath, "showWhen"],
          `The "Show the extra control when" condition of way to start "${nameOf(launch)}"`,
        );
    });
    step.displayRules?.forEach((rule, ruleIndex) =>
      checkCondition(
        rule.when,
        [...path, "displayRules", ruleIndex, "when"],
        `Progress display rule ${ruleIndex + 1} of step "${nameOf(step)}"`,
      ),
    );
  });
  const approvalIndexes: number[] = [];
  definition.actions.forEach((action, index) => {
    const path = ["actions", index];
    const owner = `Button "${nameOf(action)}"`;
    if (action.stepId !== undefined)
      checkReference(action.stepId, steps, "steps", [...path, "stepId"], owner);
    checkCondition(
      action.availableWhen,
      [...path, "availableWhen"],
      `The "Show when" condition of button "${nameOf(action)}"`,
    );
    action.labels?.forEach((variant, variantIndex) =>
      checkCondition(
        variant.when,
        [...path, "labels", variantIndex, "when"],
        `Label variant ${variantIndex + 1} of button "${nameOf(action)}"`,
      ),
    );
    if (action.kind === "approval") {
      approvalIndexes.push(index);
      return;
    }
    if (action.kind === "view") {
      if (action.stepId === undefined) return;
      if (action.target !== undefined)
        error([...path, "target"], `${owner} opens both a step and a target. Keep one of them.`);
      const step = definition.steps.find(({ id }) => id === action.stepId);
      if (step !== undefined && step.kind !== "agent")
        error(
          [...path, "stepId"],
          `${owner} opens an agent session, so it needs a step that an agent does. Pick an agent step.`,
        );
      return;
    }
    if (action.eventId !== undefined)
      checkReference(action.eventId, events, "events", [...path, "eventId"], owner);
    action.launchActionIds?.forEach((id, launchIndex) =>
      checkReference(
        id,
        launchActions,
        "launch actions",
        [...path, "launchActionIds", launchIndex],
        owner,
      ),
    );
  });
  for (const index of approvalIndexes.slice(1))
    error(
      ["actions", index],
      `Button "${nameOf(definition.actions[index]!)}" is a second approval button. Keep one approval button.`,
    );
  // The host commits these events inside a running session, where worktree.reset would stop it.
  const sessionEventSenders = new Map<string, string>();
  for (const artifact of definition.artifacts) {
    if (artifact.kind === "document") {
      if (artifact.saveEventId !== undefined)
        sessionEventSenders.set(artifact.saveEventId, `Saving document "${nameOf(artifact)}"`);
      continue;
    }
    for (const verdict of artifact.verdicts)
      sessionEventSenders.set(
        verdict.eventId,
        `Verdict "${nameOf(verdict)}" of review "${nameOf(artifact)}"`,
      );
  }
  for (const step of definition.steps)
    if (step.kind === "agent" && step.startEventId !== undefined)
      sessionEventSenders.set(step.startEventId, `Starting step "${nameOf(step)}"`);
  definition.events.forEach((event, index) => {
    const path = ["events", index];
    const owner = `Transition "${nameOf(event)}"`;
    const hasEffects = event.effects !== undefined && event.effects.length > 0;
    const sender = sessionEventSenders.get(event.id);
    if (sender !== undefined && hasEffects)
      error(
        [...path, "effects"],
        `${sender} cannot trigger "${nameOf(event)}", because it resets the work. Turn off "Reset the work", or let only buttons trigger it.`,
      );
    if (event.agent !== undefined) {
      if (hasEffects)
        error(
          [...path, "effects"],
          `Agents cannot trigger "${nameOf(event)}", because it resets the work. Turn off "Agents" or "Reset the work".`,
        );
      event.agent.roles.forEach((id, roleIndex) =>
        checkReference(id, roles, "roles", [...path, "agent", "roles", roleIndex], owner),
      );
    }
    event.effects?.forEach((effect, effectIndex) =>
      effect.clearsSessionsOf.forEach((id, roleIndex) =>
        checkReference(
          id,
          roles,
          "roles",
          [...path, "effects", effectIndex, "clearsSessionsOf", roleIndex],
          owner,
        ),
      ),
    );
    event.from.forEach((id, fromIndex) =>
      checkReference(id, states, "states", [...path, "from", fromIndex], owner),
    );
    checkIds(event.guards, "guards", [...path, "guards"], owner);
    event.guards.forEach((guard, guardIndex) =>
      checkCondition(
        guard.when,
        [...path, "guards", guardIndex, "when"],
        `Requirement ${guardIndex + 1} of transition "${nameOf(event)}"`,
      ),
    );
    event.outcomes.forEach((outcome, outcomeIndex) => {
      const outcomePath = [...path, "outcomes", outcomeIndex];
      const outcomeOwner = `Branch ${outcomeIndex + 1} of transition "${nameOf(event)}"`;
      if (outcome.to !== null)
        checkReference(outcome.to, states, "states", [...outcomePath, "to"], outcomeOwner);
      if (outcome.signal !== undefined)
        checkReference(
          outcome.signal,
          signals,
          "signals",
          [...outcomePath, "signal"],
          outcomeOwner,
        );
      if (outcome.sourceRole !== undefined)
        checkReference(
          outcome.sourceRole,
          roles,
          "roles",
          [...outcomePath, "sourceRole"],
          outcomeOwner,
        );
      checkCondition(outcome.when, [...outcomePath, "when"], outcomeOwner);
    });
  });
  definition.signals.forEach((signal, index) =>
    signal.automations.forEach((id, automationIndex) =>
      checkReference(
        id,
        automations,
        "automations",
        ["signals", index, "automations", automationIndex],
        `Autopilot signal "${nameOf(signal)}"`,
      ),
    ),
  );
  const startableLaunchList = [
    ...definition.steps.flatMap((step) => (step.kind === "agent" ? step.launchActions : [])),
    PULL_REQUEST_LAUNCH,
  ];
  const launchStartModes = new Map<string, { name: string; startModes: readonly string[] }>(
    startableLaunchList.map((launch) => [
      launch.id,
      { name: nameOf(launch), startModes: launch.startModes },
    ]),
  );
  definition.automations.forEach((automation, index) => {
    const path = ["automations", index];
    const owner = `Automation "${nameOf(automation)}"`;
    checkReference(
      automation.launchActionId,
      startableLaunches,
      "launch actions",
      [...path, "launchActionId"],
      owner,
    );
    const launch = launchStartModes.get(automation.launchActionId);
    if (
      automation.startMode !== undefined &&
      launch &&
      !launch.startModes.includes(automation.startMode)
    )
      error(
        [...path, "startMode"],
        `${owner} uses the start mode "${automation.startMode}", which way to start "${launch.name}" does not offer. Pick one of: ${launch.startModes.join(", ")}.`,
      );
  });
  const checkRules = (key: "actionOrder" | "actionPriority", name: string) =>
    definition[key].forEach((rule, index) => {
      const owner = `${name} rule ${index + 1}`;
      checkCondition(rule.when, [key, index, "when"], owner);
      rule.actions.forEach((id, actionIndex) =>
        checkReference(id, actions, "actions", [key, index, "actions", actionIndex], owner),
      );
    });
  checkRules("actionOrder", "Action order");
  checkRules("actionPriority", "Action priority");
  definition.launchOrder.forEach((rule, index) => {
    const owner = `Launch order rule ${index + 1}`;
    checkCondition(rule.when, ["launchOrder", index, "when"], owner);
    rule.order.forEach((id, orderIndex) =>
      checkReference(
        id,
        startableLaunches,
        "launch actions",
        ["launchOrder", index, "order", orderIndex],
        owner,
      ),
    );
  });
};
