import { Bell, Bot, GitMerge, Lock, Spline } from "lucide-react";
import {
  NOTIFICATION_CUE_VALUES,
  NOTIFICATION_TARGET_VALUES,
  workflowNotificationKindSchema,
  type WorkflowProblemPath,
  type WorkflowStateDefinition,
  type WorkflowStateNotification,
} from "@openducktor/contracts";
import {
  builtinNotificationDefault,
  builtinSharedState,
  idFromLabel,
} from "@openducktor/workflows";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "../editor-context";
import { type ReactElement, useRef } from "react";
import { elementIds } from "../model/document-elements";
import { isCoreState, withOptional } from "../model/document-edits";
import { vocabularyOptions } from "./element-options";
import { OptionalBooleanField, SwitchField, ToneField } from "./choice-fields";
import { MoreRules } from "./more-rules";
import { hasProblemUnder } from "./problem-paths";
import { StateTransitions } from "./state-transitions";
import { IdListField, SelectField } from "./reference-fields";
import { IdField, OptionalTextField, TextField } from "./text-fields";
import { InspectorSection } from "./inspector-section";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { useElementEdit } from "./use-element-edit";

const NOTIFICATION_PREFIX = "workflow.";
const SOUND_OPTIONS = vocabularyOptions(["inherit", "none", ...NOTIFICATION_CUE_VALUES], {
  inherit: "Use the app setting",
  none: "No sound",
});

const newNotification = (state: WorkflowStateDefinition): WorkflowStateNotification => ({
  kind: `${NOTIFICATION_PREFIX}${state.id}`,
  defaultSetting: { enabled: true, target: "both", sound: "inherit" },
  label: state.label || state.id,
  description: `A task moves to ${state.label || state.id}.`,
  title: state.label || state.id,
  body: "{{task.title}}",
  status: state.label || state.id,
  route: "kanban",
});

const notificationKindProblem = (text: string): string | undefined =>
  text.startsWith(NOTIFICATION_PREFIX) && text.length > NOTIFICATION_PREFIX.length
    ? undefined
    : `A notification kind starts with "${NOTIFICATION_PREFIX}" and has a name after it.`;

/** The notification fields outside More options. */
const NOTIFICATION_MAIN_PATHS = new Set([
  "notification",
  "notification.defaultSetting.enabled",
  "notification.defaultSetting.target",
  "notification.defaultSetting.sound",
  "notification.title",
  "notification.body",
  "notification.route",
]);

/** The first parts of the field paths of the session history. */
const HISTORY_ROOTS = ["historyRoles", "historyLatest"] as const;
/** The first parts of the field paths under Advanced. */
const IDENTITY_ROOTS = ["id", "title", "shortLabel"] as const;

const lookOf = (state: Pick<WorkflowStateDefinition, "label" | "title" | "shortLabel" | "tone">) =>
  JSON.stringify([
    state.label,
    state.title ?? state.label,
    state.shortLabel ?? state.label,
    state.tone ?? "neutral",
  ]);

/**
 * A state whose ID another workflow also uses, with another name or colour: both share one board
 * column, so they must look the same. One click matches the other workflow, or gives the state
 * its own ID.
 */
function SharedStateFix({ state }: { state: WorkflowStateDefinition }): ReactElement | null {
  const { sharedStates } = useEditor();
  const { document, readOnly, rename } = useInspector();
  const { edit } = useElementEdit("state", state.id);
  const shared = sharedStates.get(state.id);
  if (readOnly || !shared || builtinSharedState(state.id) || lookOf(shared) === lookOf(state))
    return null;
  const separate = () => {
    const taken = new Set([...elementIds(document, "state"), ...sharedStates.keys()]);
    rename("state", state.id, idFromLabel(state.label || state.id, taken));
  };
  const match = () =>
    edit((current) => {
      const named = { ...current, label: shared.label };
      const titled = withOptional(named, "title", shared.title);
      return withOptional(
        withOptional(titled, "shortLabel", shared.shortLabel),
        "tone",
        shared.tone,
      );
    });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5">
      <p className="text-xs leading-5 text-warning-surface-foreground">
        {shared.label === state.label
          ? "Another workflow shows this column in another colour."
          : `Another workflow names this column “${shared.label}”.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="xs" variant="outline" onClick={match}>
          Match it
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={separate}>
          Make it a separate state
        </Button>
      </div>
    </div>
  );
}

export function StateInspector({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { edit, editText } = useElementEdit("state", state.id);
  const builtin = builtinSharedState(state.id);
  return (
    <>
      <InspectorSection>
        <TextField
          label="Name"
          path={["label"]}
          value={builtin?.label ?? state.label}
          fixed={builtin !== undefined}
          onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
        />
        <ToneField
          path={["tone"]}
          value={builtin ? builtin.tone : state.tone}
          fixed={builtin !== undefined}
          onChange={(tone) => edit((current) => withOptional(current, "tone", tone))}
        />
        <SharedStateFix state={state} />
        {builtin ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            The built-in workflow uses this state too, so its name, title, and colour stay.
          </p>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Transitions" Icon={Spline} color="sky">
        <StateTransitions state={state} />
      </InspectorSection>

      <StateNotification state={state} />
      <StateStudio state={state} />
      <StateMergeWatch state={state} />
      <StateIdentity state={state} />
    </>
  );
}

/** The on switch of a card that turns one feature of the state on, in the card header. */
function CardSwitch({
  label,
  path,
  checked,
  onChange,
}: {
  label: string;
  path: WorkflowProblemPath;
  checked: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  const { readOnly } = useInspector();
  return (
    <span data-field-path={fieldPathAttribute(path)} className="mt-1 flex shrink-0">
      <Switch aria-label={label} checked={checked} disabled={readOnly} onCheckedChange={onChange} />
    </span>
  );
}

/** The notification of a task that arrives in the state: its text, then how it shows. */
function StateNotification({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { options, problemPaths } = useInspector();
  const { edit, editText } = useElementEdit("state", state.id);
  const notification = state.notification;
  // The settings of a notification that the user turned off come back when it turns on again.
  const lastNotification = useRef<WorkflowStateNotification | null>(null);
  const builtinDefault = notification && builtinNotificationDefault(notification.kind);
  const setting = builtinDefault ?? notification?.defaultSetting;
  const editNotification = (
    update: (value: WorkflowStateNotification) => WorkflowStateNotification,
  ) =>
    edit((current) =>
      current.notification ? { ...current, notification: update(current.notification) } : current,
    );
  const editNotificationText = (
    field: "label" | "description" | "title" | "body" | "status",
    value: string,
  ) =>
    editText(["notification", field], (current) =>
      current.notification
        ? { ...current, notification: { ...current.notification, [field]: value } }
        : current,
    );

  return (
    <InspectorSection
      title="Notification"
      description={notification ? undefined : "Tell people when a task arrives here."}
      Icon={Bell}
      color="amber"
      actions={
        <CardSwitch
          label="Send a notification"
          path={["notification"]}
          checked={notification !== undefined}
          onChange={(on) => {
            if (!on && notification) lastNotification.current = notification;
            edit((current) =>
              withOptional(
                current,
                "notification",
                on ? (lastNotification.current ?? newNotification(current)) : undefined,
              ),
            );
          }}
        />
      }
    >
      {notification ? (
        <>
          <TextField
            label="Title"
            path={["notification", "title"]}
            value={notification.title}
            onChange={(value) => editNotificationText("title", value)}
          />
          <TextField
            label="Message"
            path={["notification", "body"]}
            value={notification.body}
            multiline
            hint="Such as {{task.title}}."
            onChange={(value) => editNotificationText("body", value)}
          />
          <SelectField
            label="Show it as"
            path={["notification", "defaultSetting", "target"]}
            value={setting?.target}
            fixed={builtinDefault !== undefined}
            options={vocabularyOptions(NOTIFICATION_TARGET_VALUES, {
              in_app: "In the app",
              os: "System",
              both: "App and system",
            })}
            onChange={(target) =>
              target &&
              editNotification((current) => ({
                ...current,
                defaultSetting: { ...current.defaultSetting, target },
              }))
            }
          />
          <SelectField
            label="Sound"
            path={["notification", "defaultSetting", "sound"]}
            value={setting?.sound}
            fixed={builtinDefault !== undefined}
            options={SOUND_OPTIONS}
            onChange={(sound) =>
              sound &&
              editNotification((current) => ({
                ...current,
                defaultSetting: { ...current.defaultSetting, sound },
              }))
            }
          />
          <SwitchField
            label="On by default"
            hint="Each person can turn it off in Settings."
            path={["notification", "defaultSetting", "enabled"]}
            checked={setting?.enabled === true}
            fixed={builtinDefault !== undefined}
            onChange={(enabled) =>
              editNotification((current) => ({
                ...current,
                defaultSetting: { ...current.defaultSetting, enabled },
              }))
            }
          />
          <MoreRules
            title="More options"
            active={hasProblemUnder(problemPaths, ["notification"], NOTIFICATION_MAIN_PATHS)}
            roots={[]}
            inline
          >
            <SelectField
              label="A click opens"
              path={["notification", "route"]}
              value={notification.route}
              options={vocabularyOptions(["kanban", "agent_studio"] as const, {
                kanban: "The board",
                agent_studio: "Agent Studio",
              })}
              onChange={(route) => route && editNotification((current) => ({ ...current, route }))}
            />
            {notification.route === "agent_studio" ? (
              <SelectField
                label="With the session of"
                path={["notification", "role"]}
                value={notification.role}
                noneLabel="The role of the transition"
                options={options.boundRoles}
                onChange={(role) =>
                  editNotification((current) => withOptional(current, "role", role))
                }
              />
            ) : null}
            <TextField
              label="Name in Settings"
              path={["notification", "label"]}
              value={notification.label}
              onChange={(value) => editNotificationText("label", value)}
            />
            <TextField
              label="Text in Settings"
              path={["notification", "description"]}
              value={notification.description}
              onChange={(value) => editNotificationText("description", value)}
            />
            <TextField
              label="Status"
              path={["notification", "status"]}
              value={notification.status}
              onChange={(value) => editNotificationText("status", value)}
            />
            <IdField
              label="Kind"
              path={["notification", "kind"]}
              value={notification.kind}
              taken={new Set()}
              validate={notificationKindProblem}
              hint={
                builtinDefault
                  ? "The built-in workflow uses this kind, so its default stays."
                  : undefined
              }
              onCommit={(kind) =>
                editNotification((current) => ({
                  ...current,
                  kind: workflowNotificationKindSchema.parse(kind),
                }))
              }
            />
          </MoreRules>
        </>
      ) : null}
    </InspectorSection>
  );
}

/** The Agent Studio session that opens for a task in the state. */
function StateStudio({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { options, problemPaths } = useInspector();
  const { edit } = useElementEdit("state", state.id);
  return (
    <InspectorSection
      title="Agent Studio"
      description="What opens for a task in this state."
      Icon={Bot}
      color="emerald"
    >
      <SelectField
        label="Session"
        path={["studioRole"]}
        value={state.studioRole}
        noneLabel="Automatic"
        hint={
          state.studioRole === undefined ? "The first agent step that can run decides." : undefined
        }
        options={options.boundRoles}
        onChange={(studioRole) =>
          edit((current) => withOptional(current, "studioRole", studioRole))
        }
      />
      <MoreRules
        title="History"
        active={
          state.historyRoles !== undefined ||
          state.historyLatest !== undefined ||
          hasProblemUnder(problemPaths, HISTORY_ROOTS)
        }
        roots={HISTORY_ROOTS}
        inline
      >
        <IdListField
          label="Open the latest session of"
          path={["historyRoles"]}
          values={state.historyRoles ?? []}
          options={options.boundRoles}
          ordered
          addLabel="Add a role"
          hint="The first of these roles that has a session. Empty uses the session above."
          onChange={(historyRoles) =>
            edit((current) =>
              withOptional(
                current,
                "historyRoles",
                historyRoles.length > 0 ? historyRoles : undefined,
              ),
            )
          }
        />
        <OptionalBooleanField
          label="When none has a session"
          path={["historyLatest"]}
          value={state.historyLatest}
          defaultLabel="Automatic"
          onLabel="The latest session of any role"
          offLabel="Nothing"
          hint="Automatic opens the latest session of any role only in Done."
          onChange={(historyLatest) =>
            edit((current) => withOptional(current, "historyLatest", historyLatest))
          }
        />
      </MoreRules>
    </InspectorSection>
  );
}

/** Whether OpenDucktor checks the task branch for a merge while a task is in the state. */
function StateMergeWatch({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { edit } = useElementEdit("state", state.id);
  return (
    <InspectorSection
      title="Watch for a merge"
      description="Check whether the task branch is merged while a task is here."
      Icon={GitMerge}
      color="indigo"
      actions={
        <CardSwitch
          label="Watch for a merge"
          path={["mergeDetection"]}
          checked={state.mergeDetection === true}
          onChange={(mergeDetection) =>
            edit((current) => withOptional(current, "mergeDetection", mergeDetection || undefined))
          }
        />
      }
    >
      {null}
    </InspectorSection>
  );
}

/** The board title, the short label, and the ID of the state, which most states keep. */
function StateIdentity({ state }: { state: WorkflowStateDefinition }): ReactElement {
  const { document, rename, problemPaths } = useInspector();
  const { editText } = useElementEdit("state", state.id);
  const builtin = builtinSharedState(state.id);
  const core = isCoreState(state.id);
  const name = builtin?.label ?? (state.label || state.id);
  return (
    <MoreRules
      title="Advanced"
      description="Board title, short label, and ID"
      active={
        state.title !== undefined ||
        state.shortLabel !== undefined ||
        hasProblemUnder(problemPaths, IDENTITY_ROOTS)
      }
      roots={IDENTITY_ROOTS}
    >
      <OptionalTextField
        label="Board title"
        path={["title"]}
        value={builtin ? builtin.title : state.title}
        fixed={builtin !== undefined}
        placeholder={name}
        onChange={(title) =>
          editText(["title"], (current) => withOptional(current, "title", title))
        }
      />
      <OptionalTextField
        label="Short label"
        path={["shortLabel"]}
        value={builtin ? builtin.shortLabel : state.shortLabel}
        fixed={builtin !== undefined}
        placeholder={name}
        onChange={(shortLabel) =>
          editText(["shortLabel"], (current) => withOptional(current, "shortLabel", shortLabel))
        }
      />
      <IdField
        path={["id"]}
        value={state.id}
        taken={elementIds(document, "state")}
        fixed={core}
        hint={
          core
            ? "Every workflow has this state."
            : "Workflows with the same ID share a board column."
        }
        onCommit={(next) => rename("state", state.id, next)}
      />
    </MoreRules>
  );
}
