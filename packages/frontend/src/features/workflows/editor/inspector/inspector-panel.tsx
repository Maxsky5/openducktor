import type { WorkflowDocumentDefinition } from "@openducktor/contracts";
import {
  formatProblemPath,
  parseElementKey,
  type WorkflowElementKey,
} from "@openducktor/workflows";
import { AlertTriangle, CircleAlert, CircleMinus, Trash2, X } from "lucide-react";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import type { LocatedProblem } from "../model/editor-derivation";
import {
  elementExists,
  elementKindLabel,
  elementName,
  findElement,
  isListElementKind,
  isRuleListKind,
  type ListElementKind,
  WORKFLOW_KEY,
} from "../model/document-elements";
import { isDeletable } from "../model/document-edits";
import { eventSummary } from "../model/event-summary";
import { focusField } from "../model/field-focus";
import { ProblemText } from "../problem-text";
import { TooltipButton } from "../../tooltip-button";
import { KindTile } from "../kind-theme";
import { ActionInspector } from "./action-inspector";
import { ArtifactInspector } from "./artifact-inspector";
import { AutomationInspector, SignalInspector } from "./autopilot-inspectors";
import { elementOptions } from "./element-options";
import { EventInspector } from "./event-inspector";
import { InspectorContext, type InspectorContextValue } from "./inspector-context";
import { PromptInspector, PromptsOverview } from "./prompt-inspector";
import { RoleInspector } from "./role-inspector";
import { RuleListInspector } from "./rule-list-inspector";
import { StateInspector } from "./state-inspector";
import { StepInspector } from "./step-inspector";
import { IssueTypeInspector, WorkflowInspector } from "./workflow-inspector";

/** A fixed text, such as the ID after the first publication, keeps full-contrast text on a muted fill. */
const FIXED_TEXT_CLASS =
  "[&_:is(input,textarea):read-only]:border-transparent [&_:is(input,textarea):read-only]:bg-muted dark:[&_:is(input,textarea):read-only]:bg-muted/50 [&_:is(input,textarea):read-only]:text-foreground";

/**
 * Read-only fields keep full-contrast text instead of the faded disabled style. They lose the
 * chevrons that offer a choice.
 */
const READ_ONLY_FIELDS_CLASS =
  "[&_:is(button,input,textarea):disabled]:cursor-default [&_:is(button,input,textarea):disabled]:opacity-100 [&_button[aria-haspopup]:disabled]:bg-muted/60 [&_button:disabled_.lucide-chevrons-up-down]:hidden";

/**
 * The kind, name, and help line of the selected element, with its Delete and Close buttons. A
 * transition also shows its route.
 */
function InspectorHeader({
  elementKey: key,
  headingRef,
}: {
  elementKey: WorkflowElementKey;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const { store, catalogRoles } = useEditor();
  const document = useEditorState((state) => state.document);
  const readOnly = useEditorState((state) => state.readOnly);
  const { kind, id } = parseElementKey(key);
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  const name =
    kind === "role"
      ? (roleLabels.get(id) ?? elementName(document, key))
      : elementName(document, key, roleLabels);
  const event =
    kind === "event" ? document.definition.events.find((item) => item.id === id) : undefined;
  const review =
    kind === "artifact" &&
    document.definition.artifacts.some((item) => item.id === id && item.kind === "review");
  const headerHelp = () => {
    if (event) return eventSummary(document.definition, event, roleLabels);
    if (review) return "A reset deletes this review.";
    if (kind === "issueType")
      return `Built-in type: ${id}. You change only how this workflow shows it.`;
    return null;
  };
  const kindLabel = elementKindLabel(kind);
  const deletable = !readOnly && isDeletable(key);
  // A role or an issue type stays outside the workflow, so its button removes, not deletes.
  const removes = kind === "role" || kind === "issueType";
  const RemoveIcon = removes ? CircleMinus : Trash2;
  return (
    <header className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <KindTile kind={kind} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-xs font-medium text-muted-foreground">{kindLabel}</p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            data-inspector-heading=""
            title={name}
            className="line-clamp-2 text-[15px] leading-5 font-semibold tracking-tight outline-none"
          >
            {name}
          </h2>
        </div>
        {deletable ? (
          <TooltipButton
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-muted"
            label={removes ? "Remove from this workflow" : `Delete this ${kindLabel.toLowerCase()}`}
            onClick={() => store.getState().requestRemove(key)}
          >
            <RemoveIcon className="size-4" />
          </TooltipButton>
        ) : null}
        <TooltipButton
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground"
          label="Close"
          tooltip="Close (Esc)"
          onClick={() => store.getState().select(null)}
        >
          <X className="size-4" />
        </TooltipButton>
      </div>
      {headerHelp() ? (
        <p className="mt-1.5 pl-13 text-xs leading-5 text-pretty text-muted-foreground">
          {headerHelp()}
        </p>
      ) : null}
    </header>
  );
}

const NO_PROBLEMS: readonly LocatedProblem[] = [];

/** The fields of the selected element. Without a selection, the workflow fields. */
export function InspectorPanel(): ReactElement {
  const environment = useEditor();
  const { store, catalogRoles, roles, published, takenWorkflowIds } = environment;
  const document = useEditorState((state) => state.document);
  const selection = useEditorState((state) => state.selection);
  const readOnly = useEditorState((state) => state.readOnly);
  const { change, rename, select, create } = store.getState();
  const key = selection && elementExists(document, selection.key) ? selection.key : WORKFLOW_KEY;
  const problems = useEditorView((view) => view.problemsByElement.get(key) ?? NO_PROBLEMS);
  const options = useMemo(() => elementOptions(document, catalogRoles), [document, catalogRoles]);
  const problemPaths = useMemo(
    () => new Set(problems.map(({ target }) => formatProblemPath(target.fieldPath))),
    [problems],
  );
  const context = useMemo<InspectorContextValue>(
    () => ({
      readOnly,
      document,
      elementKey: key,
      problemPaths,
      change,
      rename,
      create,
      select: (next) => select(next),
      options,
      catalogRoles,
      roles,
      published,
      takenWorkflowIds,
    }),
    [
      readOnly,
      document,
      key,
      problemPaths,
      change,
      rename,
      create,
      select,
      options,
      catalogRoles,
      roles,
      published,
      takenWorkflowIds,
    ],
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusRequest = selection?.focusRequest ?? 0;
  // The details of one element keep their state across a rename of its ID.
  const instance = selection?.instance ?? 0;
  const fieldPath = selection?.fieldPath;
  // Only a new focus request moves the focus. A later plain selection keeps the old path.
  const focusRequestedField = useEffectEvent(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !fieldPath) return;
    if (!focusField(scroller, fieldPath)) headingRef.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (focusRequest !== 0) focusRequestedField();
  }, [focusRequest]);
  // Another element opens at the top of its details. A focus request then scrolls to its field.
  useLayoutEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [instance]);
  // A link inside the details unmounts with the old element, so its focus moves to the heading.
  useEffect(() => {
    const page = headingRef.current?.ownerDocument;
    const active = page?.activeElement;
    if (!active || active === page.body || !active.isConnected)
      headingRef.current?.focus({ preventScroll: true });
  }, [instance]);

  return (
    <InspectorContext value={context}>
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col">
          <InspectorHeader elementKey={key} headingRef={headingRef} />
          <div
            ref={scrollerRef}
            data-inspector-fields=""
            className={cn(
              // The scrollbar keeps its 10 px place, so the fields never move when it comes. With
              // the right padding, it makes the same space as the left padding.
              "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/60 py-3 pr-0.5 pl-3 [scrollbar-gutter:stable] dark:bg-background/40",
              FIXED_TEXT_CLASS,
              readOnly && READ_ONLY_FIELDS_CLASS,
            )}
          >
            {problems.length > 0 ? (
              <ul
                aria-label="Problems of this element"
                className={cn(
                  "flex shrink-0 flex-col gap-1 rounded-xl border p-2",
                  problems.some(({ severity }) => severity === "error")
                    ? "border-destructive-border bg-destructive-surface"
                    : "border-warning-border bg-warning-surface",
                )}
              >
                {problems.map((problem) => (
                  <li
                    key={`${problem.severity}:${problem.message}:${formatProblemPath(problem.path)}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs leading-5 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => select(key, problem.target.fieldPath)}
                    >
                      {problem.severity === "error" ? (
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive-muted" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-muted" />
                      )}
                      <span>
                        <ProblemText message={problem.message} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ElementFields key={instance} elementKey={key} />
          </div>
        </div>
      </TooltipProvider>
    </InspectorContext>
  );
}

/** Renders an inspector for an item, or nothing when the item is gone. */
const withItem = <Item,>(item: Item | undefined, render: (item: Item) => ReactNode): ReactNode =>
  item === undefined ? null : render(item);

/** The inspector of each kind of list element. */
const LIST_INSPECTORS = {
  issueType: (definition, id) =>
    withItem(findElement(definition, "issueType", id), (issueType) => (
      <IssueTypeInspector issueType={issueType} />
    )),
  role: (definition, id) =>
    withItem(findElement(definition, "role", id), (binding) => <RoleInspector binding={binding} />),
  artifact: (definition, id) =>
    withItem(findElement(definition, "artifact", id), (artifact) => (
      <ArtifactInspector artifact={artifact} />
    )),
  state: (definition, id) =>
    withItem(findElement(definition, "state", id), (state) => <StateInspector state={state} />),
  step: (definition, id) =>
    withItem(findElement(definition, "step", id), (step) => <StepInspector step={step} />),
  action: (definition, id) =>
    withItem(findElement(definition, "action", id), (action) => (
      <ActionInspector action={action} />
    )),
  event: (definition, id) =>
    withItem(findElement(definition, "event", id), (event) => <EventInspector event={event} />),
  signal: (definition, id) =>
    withItem(findElement(definition, "signal", id), (signal) => (
      <SignalInspector signal={signal} />
    )),
  automation: (definition, id) =>
    withItem(findElement(definition, "automation", id), (automation) => (
      <AutomationInspector automation={automation} />
    )),
} satisfies {
  [Kind in ListElementKind]: (definition: WorkflowDocumentDefinition, id: string) => ReactNode;
};

function ElementFields({ elementKey }: { elementKey: WorkflowElementKey }): ReactNode {
  const document = useEditorState((state) => state.document);
  const { kind, id } = parseElementKey(elementKey);
  if (kind === "workflow") return <WorkflowInspector />;
  if (isRuleListKind(kind)) return <RuleListInspector kind={kind} />;
  if (kind === "prompt") {
    const prompt = document.prompts.find((candidate) => candidate.id === id);
    return prompt ? <PromptInspector prompt={prompt} /> : <PromptsOverview />;
  }
  return isListElementKind(kind) ? LIST_INSPECTORS[kind](document.definition, id) : null;
}
