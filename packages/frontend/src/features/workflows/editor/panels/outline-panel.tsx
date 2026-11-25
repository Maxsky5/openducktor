import type {
  WorkflowActionDefinition,
  WorkflowDocument,
  WorkflowDocumentDefinition,
  WorkflowStepDefinition,
} from "@openducktor/contracts";
import {
  columnOrder,
  elementKey,
  parseElementKey,
  type WorkflowElementKind,
} from "@openducktor/workflows";
import {
  Bot,
  ChevronRight,
  ClipboardCheck,
  Eye,
  MessageSquareText,
  MessagesSquare,
  FileText,
  type LucideIcon,
  MousePointerClick,
  MoveRight,
  Play,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";
import {
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { cn } from "@/lib/utils";
import { toneAccentClass } from "../../state-tone";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import type { ProblemLevel } from "../model/canvas-graph";
import { IconTile, KindTile } from "../kind-theme";
import { KIND_THEME } from "../kind-styles";
import { swapInList } from "../model/swap-in-list";
import { addAction, addState } from "../model/create-elements";
import {
  elementKindLabel,
  eventRowNames,
  eventRouteLabel,
  eventSourcesTitle,
  PROMPTS_KEY,
  RULE_LISTS,
  WORKFLOW_KEY,
} from "../model/document-elements";
import {
  addArtifact,
  addAutomation,
  addIssueType,
  addSignal,
  addStep,
  bindRole,
  BUILTIN_ISSUE_TYPES,
  type CreatedElement,
  isCoreState,
  newStepRole,
  updateDefinition,
} from "../model/document-edits";
import { eventSenders, senderText } from "../model/event-senders";
import { IssueTypeIcon } from "../inspector/workflow-inspector";
import { AddTransitionButton } from "./add-transition-button";
import {
  CONTENT_MENU_CLASS,
  type KindOption,
  LINK_BUTTON_CLASS,
  NewElementButton,
} from "./new-element-button";
import { Dot, OUTLINE_ROW_CLASS, OutlineSection, RowIcon } from "./outline-group";
import { OutlineSearchContext, outlineItems } from "./outline-items";
import { ProblemMarker } from "./problem-marker";

type Create = (make: (current: WorkflowDocument) => CreatedElement) => void;

/** What a button does, in a few words: "Moves to Triage", "Starts Builder", "Opens Builder". */
const buttonEffect = (
  definition: WorkflowDocumentDefinition,
  action: WorkflowDocumentDefinition["actions"][number],
): string => {
  const stateName = (id: string) => {
    const state = definition.states.find((item) => item.id === id);
    return state ? state.label || state.id : id;
  };
  const stepOfLaunch = (launchId: string | undefined) =>
    definition.steps.find(
      (step) => step.kind === "agent" && step.launchActions.some(({ id }) => id === launchId),
    );
  if (action.kind === "event") {
    const event = definition.events.find(({ id }) => id === action.eventId);
    const targets = [
      ...new Set(event?.outcomes.flatMap(({ to }) => (to === null ? [] : [stateName(to)])) ?? []),
    ];
    return targets.length > 0 ? `Moves to ${targets.join(" or ")}` : "Moves the task";
  }
  if (action.kind === "session") {
    const step = stepOfLaunch(action.launchActionIds[0]);
    return step ? `Starts ${step.label || step.id}` : "Starts an agent";
  }
  if (action.kind === "view") {
    const step = definition.steps.find(({ id }) => id === action.stepId);
    return step ? `Opens ${step.label || step.id}` : "Opens the task details";
  }
  return "Approves the work";
};

const ACTION_KINDS = [
  {
    value: "event",
    label: "Move the task",
    description: "A button that moves the task to another state.",
  },
  {
    value: "session",
    label: "Start an agent",
    description: "A button that starts an agent session.",
  },
  {
    value: "view",
    label: "Open a view",
    description: "A button that opens the task details or a session.",
  },
  {
    value: "approval",
    label: "Open approval",
    description: "A button that opens the approval of the task.",
  },
] as const satisfies readonly KindOption<WorkflowActionDefinition["kind"]>[];

const ACTION_ICONS = {
  event: MousePointerClick,
  session: Play,
  view: Eye,
  approval: ShieldCheck,
} satisfies Record<WorkflowActionDefinition["kind"], LucideIcon>;

/** The step kinds. An agent step needs a role, so the Agent kind is off when no role exists. */
const stepKinds = (hasRole: boolean) =>
  [
    hasRole
      ? {
          value: "agent",
          label: "Agent",
          description: "An AI agent does this step, such as writing a spec.",
        }
      : {
          value: "agent",
          label: "Agent",
          description: "No role exists. Add a role first.",
          disabled: true,
        },
    {
      value: "human",
      label: "Person",
      description: "A person does this step, such as a review.",
    },
  ] as const satisfies readonly KindOption<WorkflowStepDefinition["kind"]>[];

const ARTIFACT_KINDS = [
  {
    value: "document",
    label: "Document",
    description: "Text that an agent writes, such as a spec.",
  },
  { value: "review", label: "Review", description: "A verdict with notes, such as a QA report." },
] as const;

/** What each rule list decides, in one line. */
const RULE_LIST_HELP = {
  actionOrder: "The order of the buttons of a task.",
  actionPriority: "The buttons that come first, before that order.",
  launchOrder: "The agent launch that a task offers first.",
} satisfies Record<(typeof RULE_LISTS)[number], string>;

/** The element kinds of the Advanced group. */
const ADVANCED_KINDS: ReadonlySet<WorkflowElementKind> = new Set([
  "signal",
  "automation",
  "prompt",
  ...RULE_LISTS,
]);

/** The row that opens the name, issue types, and pull request settings of the workflow. */
function WorkflowSettingsRow(): ReactElement {
  const { store } = useEditor();
  const problem = useEditorView((view) => view.problemLevels.get(WORKFLOW_KEY) ?? null);
  const selected = useEditorState((state) => state.selection?.key === WORKFLOW_KEY);
  return (
    <div className="pt-2 pb-1">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        className={cn(
          OUTLINE_ROW_CLASS,
          // A card: the selection takes the primary border, and the card keeps its surface.
          "border border-border bg-card px-2.5 py-2 shadow-xs aria-[current=true]:border-primary aria-[current=true]:bg-card",
        )}
        onClick={() => store.getState().select(WORKFLOW_KEY)}
      >
        <KindTile kind="workflow" />
        <span className="min-w-0 flex-1 truncate font-semibold">Workflow settings</span>
        <ProblemMarker level={problem} />
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}

/** Adds a role of the host to the workflow, or creates a new role. */
function AddRole({ create, variant }: { create: Create; variant: "icon" | "link" }): ReactElement {
  const { catalogRoles, roles } = useEditor();
  const definition = useEditorState((state) => state.document.definition);
  const [open, setOpen] = useState(false);
  const added = new Set(definition.roles.map(({ id }) => id));
  const available = catalogRoles.filter(({ role }) => !added.has(role.id));
  const trigger =
    variant === "icon" ? (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6 text-muted-foreground hover:text-foreground"
        aria-label="Add a role"
        title="Add a role"
      >
        <Plus className="size-4" />
      </Button>
    ) : (
      <button type="button" className={LINK_BUTTON_CLASS}>
        <Plus aria-hidden="true" className="size-3.5" />
        Add a role
      </button>
    );
  return (
    <Combobox
      value=""
      open={open}
      onOpenChange={setOpen}
      listLabel="Roles"
      options={available.map(({ role, source }) => ({
        value: role.id,
        label: role.label,
        secondaryLabel: source === "builtin" ? "Built-in" : "Custom",
      }))}
      searchPlaceholder="Search roles"
      emptyText="Every role is in this workflow."
      onValueChange={(roleId) => create((current) => bindRole(current, roleId))}
      className="w-64"
      footer={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start gap-2 font-normal"
          onClick={() => {
            setOpen(false);
            roles.newRole();
          }}
        >
          <Plus className="size-4" />
          Create a new role
        </Button>
      }
      trigger={trigger}
    />
  );
}

/** Adds one of the built-in issue types that the workflow does not support yet. */
function AddIssueType({
  create,
  variant,
}: {
  create: Create;
  variant: "icon" | "link";
}): ReactElement {
  const issueTypes = useEditorState((state) => state.document.definition.issueTypes);
  const added = new Set(issueTypes.map(({ id }) => id));
  const available = [...BUILTIN_ISSUE_TYPES.values()].filter(({ id }) => !added.has(id));
  const trigger =
    variant === "icon" ? (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6 text-muted-foreground hover:text-foreground"
        aria-label="Add an issue type"
        title="Add an issue type"
      >
        <Plus className="size-4" />
      </Button>
    ) : (
      <button type="button" className={LINK_BUTTON_CLASS}>
        <Plus aria-hidden="true" className="size-3.5" />
        Add an issue type
      </button>
    );
  return (
    <Combobox
      value=""
      listLabel="Issue types"
      options={available.map((issueType) => ({
        value: issueType.id,
        label: issueType.label,
        icon: <IssueTypeIcon issueType={issueType} />,
      }))}
      searchable={false}
      emptyText="Every issue type is in this workflow."
      onValueChange={(value) => {
        const picked = available.find(({ id }) => id === value);
        if (picked) create((current) => addIssueType(current, picked.id));
      }}
      className={CONTENT_MENU_CLASS}
      trigger={trigger}
    />
  );
}

/**
 * Autopilot, rules, and prompts. The group starts closed, and opens by itself while one of its
 * elements has a problem or the selection moves into it.
 */
function AdvancedGroup({ children }: { children: ReactNode }): ReactElement {
  // The worst problem inside the group, or null.
  const problem = useEditorView((view) => {
    let worst: ProblemLevel | null = null;
    for (const [key, level] of view.problemLevels)
      if (ADVANCED_KINDS.has(parseElementKey(key).kind) && worst !== "error") worst = level;
    return worst;
  });
  const hasProblem = problem !== null;
  const searching = useContext(OutlineSearchContext).trim().length > 0;
  const selectionKey = useEditorState((state) => state.selection?.key ?? null);
  const contentId = useId();
  const selectedInside =
    selectionKey !== null && ADVANCED_KINDS.has(parseElementKey(selectionKey).kind);
  // Null follows the problems. A selection inside the group opens it, and it stays open when the
  // selection leaves it. A click on the title decides until the selection moves into it again.
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (seenSelection !== selectionKey) {
    setSeenSelection(selectionKey);
    if (selectedInside) setChosenOpen(true);
  }
  const open = chosenOpen ?? (selectedInside || hasProblem);
  // A search shows the matching sections of the group in place, like the other sections.
  if (searching) return <>{children}</>;
  return (
    <section className="mt-2 mb-4 border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setChosenOpen(!open)}
        title="Autopilot, button order, prompts"
        // The same card as Workflow settings, the other entry outside the sections.
        className={cn(OUTLINE_ROW_CLASS, "border border-border bg-card px-2.5 py-2 shadow-xs")}
      >
        <IconTile Icon={SlidersHorizontal} color="slate" />
        <span className="min-w-0 flex-1 truncate font-semibold">Advanced</span>
        <ProblemMarker level={problem} />
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-90",
          )}
        />
      </button>
      <CssPresenceReveal open={open}>
        <div id={contentId}>{children}</div>
      </CssPresenceReveal>
    </section>
  );
}

/** Adds an element in one undo step and selects it. */
const useCreate = (): Create => {
  const { store } = useEditor();
  return useCallback((make) => store.getState().create(make), [store]);
};

/** The label of each role of the host catalog. */
const useRoleLabels = (): ReadonlyMap<string, string> => {
  const { catalogRoles } = useEditor();
  return useMemo(
    () => new Map(catalogRoles.map(({ role }) => [role.id, role.label])),
    [catalogRoles],
  );
};

// Each section reads only the lists that it shows, so an edit renders only the sections that
// show the edited list.

const StatesSection = memo(function StatesSection(): ReactElement {
  const { store, sharedStates } = useEditor();
  const create = useCreate();
  const states = useEditorState((state) => state.document.definition.states);
  const columns = columnOrder(states);
  const newState = (variant: "icon" | "link") => (
    <NewElementButton
      variant={variant}
      label="Add a state"
      placeholder="Such as In review"
      onCreate={(name) => create((current) => addState(current, name, sharedStates))}
    />
  );
  return (
    <OutlineSection
      kind="state"
      title="States"
      description="Each state is a column on the board, in this order."
      items={outlineItems(
        "state",
        columns.map(({ state }) => state),
        (state) => ({
          leading: <Dot className={toneAccentClass(state.tone ?? "neutral")} />,
        }),
      )}
      reorder={{
        // Backlog and Done stay first and last, as on the board.
        pinned: (place) => isCoreState(columns[place]!.state.id),
        move: (place, offset) => {
          const from = columns[place]!.index;
          const to = columns[place + offset]!.index;
          store.getState().change((current) =>
            updateDefinition(current, (value) => ({
              ...value,
              states: swapInList(value.states, from, to),
            })),
          );
        },
      }}
      add={newState("icon")}
      emptyAction={newState("link")}
    />
  );
});

/** A route whose lines break only between state names, never inside one. */
const keepNames = (route: string): string =>
  route
    .split(/( → |, )/)
    .map((part) => {
      // The arrow stays with the target, so a line never ends on it.
      if (part === " → ") return " →\u00a0";
      return part === ", " ? part : part.replaceAll(" ", "\u00a0");
    })
    .join("");

const TransitionsSection = memo(function TransitionsSection(): ReactElement {
  const roleLabels = useRoleLabels();
  // The names and the triggers of the transitions read most lists of the definition.
  const definition = useEditorState((state) => state.document.definition);
  // The route line under each row tells rows with the same name apart.
  const eventTitles = eventRowNames(definition, roleLabels);
  const senders = eventSenders(definition);
  return (
    <OutlineSection
      kind="event"
      title="Transitions"
      description="A transition moves a task from one state to another. Draw one on the canvas from the dot of a state."
      items={definition.events.map((event) => {
        const triggers = (senders.get(event.id) ?? []).map((sender) =>
          senderText(sender, roleLabels),
        );
        const route = eventRouteLabel(definition, event);
        return {
          key: elementKey("event", event.id),
          label: eventTitles.get(event.id) ?? event.id,
          leading: event.effects?.some(({ id }) => id === "worktree.reset") ? (
            <RowIcon Icon={RotateCcw} color="rose" />
          ) : (
            <RowIcon Icon={MoveRight} color="sky" />
          ),
          searchText: `${triggers.join(" ")} ${route}`,
          subtitle:
            triggers.length > 0 ? (
              keepNames(route)
            ) : (
              <span className="text-warning-muted">No trigger yet</span>
            ),
          title: eventSourcesTitle(definition, event) ?? undefined,
        };
      })}
      add={<AddTransitionButton variant="icon" label="Add a transition" />}
      emptyAction={<AddTransitionButton variant="link" label="Add a transition" />}
    />
  );
});

const ButtonsSection = memo(function ButtonsSection(): ReactElement {
  const create = useCreate();
  // What a button does names states, transitions, and steps.
  const definition = useEditorState((state) => state.document.definition);
  const newAction = (variant: "icon" | "link") => (
    <NewElementButton
      variant={variant}
      label="Add a button"
      placeholder="Such as Start review"
      kinds={ACTION_KINDS}
      onCreate={(name, kind) => create((current) => addAction(current, name, kind))}
    />
  );
  return (
    <OutlineSection
      kind="action"
      // Buttons that only move the task show in the triggers of their transitions too, so the
      // section starts folded until another kind of button comes.
      foldedAtStart={definition.actions.every(({ kind }) => kind === "event")}
      title="Buttons"
      description="The buttons of a task, on the board, in the task details, and in Agent Studio."
      items={outlineItems("action", definition.actions, (action) => ({
        leading: <RowIcon Icon={ACTION_ICONS[action.kind]} color="amber" />,
        subtitle: buttonEffect(definition, action),
      }))}
      add={newAction("icon")}
      emptyAction={newAction("link")}
    />
  );
});

const RolesSection = memo(function RolesSection(): ReactElement {
  const create = useCreate();
  const roleLabels = useRoleLabels();
  const roles = useEditorState((state) => state.document.definition.roles);
  return (
    <OutlineSection
      kind="role"
      title="Roles"
      description="The agents that this workflow can start, such as Planner or QA."
      items={roles.map((role) => ({
        key: elementKey("role", role.id),
        label: roleLabels.get(role.id) ?? role.id,
        title: role.id,
        leading: <RowIcon Icon={Bot} color="emerald" />,
      }))}
      add={<AddRole create={create} variant="icon" />}
      emptyAction={<AddRole create={create} variant="link" />}
    />
  );
});

const StepsSection = memo(function StepsSection(): ReactElement {
  const { catalogRoles } = useEditor();
  const create = useCreate();
  const steps = useEditorState((state) => state.document.definition.steps);
  const roleId = useEditorState((state) => newStepRole(state.document.definition, catalogRoles));
  const newStep = (variant: "icon" | "link") => (
    <NewElementButton
      variant={variant}
      label="Add a step"
      placeholder="Such as Code review"
      kinds={stepKinds(roleId !== undefined)}
      onCreate={(name, kind) => {
        if (kind === "human") create((current) => addStep(current, name, { kind }));
        else if (roleId !== undefined)
          create((current) => addStep(current, name, { kind, roleId }));
      }}
    />
  );
  return (
    <OutlineSection
      kind="step"
      title="Steps"
      description="The stages of work on a task. An agent or a person does each step."
      items={outlineItems("step", steps, (step) => ({
        leading: <RowIcon Icon={step.kind === "agent" ? Bot : User} color="indigo" />,
      }))}
      add={newStep("icon")}
      emptyAction={newStep("link")}
    />
  );
});

const ArtifactsSection = memo(function ArtifactsSection(): ReactElement {
  const create = useCreate();
  const artifacts = useEditorState((state) => state.document.definition.artifacts);
  const newArtifact = (variant: "icon" | "link") => (
    <NewElementButton
      variant={variant}
      label="Add an artifact"
      placeholder="Such as Test plan"
      kinds={ARTIFACT_KINDS}
      onCreate={(name, kind) => create((current) => addArtifact(current, name, kind))}
    />
  );
  return (
    <OutlineSection
      kind="artifact"
      title="Artifacts"
      description="The documents that agents write on a task, such as a spec or a QA report."
      items={outlineItems("artifact", artifacts, (artifact) => ({
        leading: (
          <RowIcon Icon={artifact.kind === "review" ? ClipboardCheck : FileText} color="rose" />
        ),
      }))}
      add={newArtifact("icon")}
      emptyAction={newArtifact("link")}
    />
  );
});

const IssueTypesSection = memo(function IssueTypesSection(): ReactElement {
  const create = useCreate();
  const issueTypes = useEditorState((state) => state.document.definition.issueTypes);
  return (
    <OutlineSection
      kind="issueType"
      title="Issue types"
      description="The built-in types that new tasks of this workflow can pick: task, feature, and bug. You can rename each one for this workflow."
      foldedAtStart
      items={outlineItems("issueType", issueTypes, (issueType) => ({
        leading: <IssueTypeIcon issueType={issueType} />,
      }))}
      add={<AddIssueType create={create} variant="icon" />}
      emptyAction={<AddIssueType create={create} variant="link" />}
    />
  );
});

const AutopilotSections = memo(function AutopilotSections(): ReactElement {
  const create = useCreate();
  const signals = useEditorState((state) => state.document.definition.signals);
  const automations = useEditorState((state) => state.document.definition.automations);
  return (
    <>
      <OutlineSection
        kind="signal"
        title="Autopilot signals"
        description="Moments that a transition reports, such as a finished review."
        items={outlineItems("signal", signals, () => ({
          leading: <RowIcon Icon={Radio} color="fuchsia" />,
        }))}
        add={
          <NewElementButton
            variant="icon"
            label="Add a signal"
            placeholder="Such as Review done"
            onCreate={(name) => create((current) => addSignal(current, name))}
          />
        }
      />
      <OutlineSection
        kind="automation"
        title="Automations"
        description="What Autopilot starts by itself when a signal comes."
        items={outlineItems("automation", automations, () => ({
          leading: <RowIcon Icon={Play} color="fuchsia" />,
        }))}
        add={
          <NewElementButton
            variant="icon"
            label="Add an automation"
            placeholder="Such as Start QA"
            onCreate={(name) => create((current) => addAutomation(current, name))}
          />
        }
      />
    </>
  );
});

const RulesSection = memo(function RulesSection(): ReactElement {
  // The counts only, so an edit of a rule list renders this section and nothing else.
  const counts = useEditorState(
    useShallow((state) => RULE_LISTS.map((kind) => state.document.definition[kind].length)),
  );
  return (
    <OutlineSection
      kind="actionOrder"
      title="Rules"
      description="The order of buttons and agent launches."
      count={0}
      items={RULE_LISTS.map((kind, place) => ({
        key: elementKey(kind),
        label: elementKindLabel(kind),
        detail: String(counts[place]),
        title: RULE_LIST_HELP[kind],
        leading: <RowIcon Icon={KIND_THEME[kind].Icon} color="slate" />,
      }))}
    />
  );
});

const PromptsSection = memo(function PromptsSection(): ReactElement {
  const prompts = useEditorState((state) => state.document.prompts);
  return (
    <OutlineSection
      kind="prompt"
      title="Prompts"
      description="The text that each agent gets."
      count={prompts.length}
      items={[
        {
          key: PROMPTS_KEY,
          label: "All prompts",
          detail: String(prompts.length),
          leading: <RowIcon Icon={MessagesSquare} color="orange" />,
        },
        ...prompts.map((prompt) => ({
          key: elementKey("prompt", prompt.id),
          label: prompt.label || prompt.id,
          leading: <RowIcon Icon={MessageSquareText} color="orange" />,
        })),
      ]}
    />
  );
});

/** Every element of the workflow, in sections. A click selects an element. */
export function OutlinePanel(): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState("");
  return (
    <nav aria-label="Workflow elements" className="flex h-full min-h-0 flex-col">
      {/* The search lines up with the canvas toolbar. */}
      <div className="shrink-0 border-b border-border p-3">
        <ToolbarSearchField
          id={searchId}
          label="Find an element"
          placeholder="Find a state, a role…"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <OutlineSearchContext value={query}>
        {/* The scrollbar keeps its 10 px place, so the rows never move when it comes. With the
            right padding, it makes the same space as the left padding. */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-2 pl-3 pr-0.5 [scrollbar-gutter:stable]">
          {query.trim() ? null : <WorkflowSettingsRow />}
          <StatesSection />
          <TransitionsSection />
          <ButtonsSection />
          <RolesSection />
          <StepsSection />
          <ArtifactsSection />
          <IssueTypesSection />
          <AdvancedGroup>
            <AutopilotSections />
            <RulesSection />
            <PromptsSection />
          </AdvancedGroup>
          {/* Shows only when no section matches the search, so it is the only child. */}
          <p className="hidden px-2 py-6 text-center text-xs leading-5 text-muted-foreground only:block">
            No element matches “{query.trim()}”.
          </p>
        </div>
      </OutlineSearchContext>
    </nav>
  );
}
