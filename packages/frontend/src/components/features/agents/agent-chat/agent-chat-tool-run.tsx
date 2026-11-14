import { readMessageTimeLabel } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import { getToolDuration } from "@openducktor/frontend-core/sessions/messages/tool-duration";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import {
  readEarlierCallStep,
  readHideEarlierCallsLabel,
  readShowEarlierCallsLabel,
  readToolRunCallLine,
  readToolRunCountLabels,
  readToolRunStates,
  readToolRunTitle,
  type ToolRunCallLine,
  type ToolRunRow,
  type ToolRunState,
  type ToolRunTitle,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUp,
  FileSearch,
  Globe,
  type LucideIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import {
  Fragment,
  memo,
  type ReactElement,
  type RefObject,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { MOTION_EASE_OUT, prefersReducedMotion } from "@/components/ui/motion";
import { plural } from "@openducktor/frontend-core/lib/plural";
import { cn } from "@/lib/utils";
import { ToolRunActionsContext } from "./agent-chat-tool-run-folds";
import type { ToolRunItem } from "./agent-chat-tool-run-layout";
import { useToolDetailsRow } from "./agent-chat-tool-details-store";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";
import { TOOL_ROW_HOVER, TOOL_ROW_SELECTED } from "./agent-chat-tool-row-states";
import { ToolCallIcon } from "./agent-chat-tool-status";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { useValueAtMount } from "./use-value-at-mount";
import "./agent-chat-tool-run.css";

type RuntimePresentation = AgentChatThreadModel["runtimePresentation"];

type ToolRunGroupProps = {
  item: ToolRunItem;
  /** Names the tool of each call in the run that is not a shell command. */
  runtimePresentation: RuntimePresentation;
  /** The folder of the session. The paths of file reads and searches show relative to it. */
  workingDirectory: string | null;
};

const areToolRunGroupPropsEqual = (previous: ToolRunGroupProps, next: ToolRunGroupProps): boolean =>
  previous.runtimePresentation === next.runtimePresentation &&
  previous.workingDirectory === next.workingDirectory &&
  // A tool run keeps its item while its calls and its folds do not change.
  previous.item === next.item;

/** True once a value differs from its value when the component mounted. */
const useChangedSinceMount = <Value,>(value: Value): boolean => value !== useValueAtMount(value);

// A call under the header of its run starts under the label of the header.
const NESTED_ROW_PLACE = "-mr-2 w-[calc(100%+0.5rem)]";

// The bar of the earlier calls has the height of a call line, so it takes the place of a call
// without a change of height.
const BAR_ROW_PADDING = "py-[3px]";

const ROW_CLASS_NAME =
  "group/line flex min-h-6 w-full min-w-0 items-center gap-2 rounded-[7px] px-2 text-left text-xs";

/**
 * A tool row. A row that the details can show, with `isShown` not null, gets the shared hover,
 * selection, and focus of tool rows.
 */
const rowClassName = (isShown: boolean | null): string => {
  if (isShown === null) return ROW_CLASS_NAME;
  return cn(
    ROW_CLASS_NAME,
    "cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
    isShown ? TOOL_ROW_SELECTED : TOOL_ROW_HOVER,
  );
};

/**
 * The consecutive tool run calls of a turn: shell commands, file reads, lists, searches, and edits,
 * web searches, and the calls of tools that show one line, such as MCP tools. Each call is one row,
 * as the other tool rows: its status or tool, its command or its summary, its error preview when
 * it failed, and its timing. A press on a row shows the call in the tool details panel. Each run,
 * also a run of one call, gets a header with its counts and state, which folds it, so nothing
 * moves when the next call comes. The calls show under the header along a guide line. A long run
 * shows its latest calls under a control that shows the others.
 */
export const ToolRunGroup = memo(function ToolRunGroup({
  item,
  runtimePresentation,
  workingDirectory,
}: ToolRunGroupProps): ReactElement {
  const actions = useContext(ToolRunActionsContext);
  const headerRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const countLabels = readToolRunCountLabels(item);
  const summary = <ToolRunHeader item={item} countLabels={countLabels} />;
  // The run is one row of the row window, so the window measures and anchors the whole run.
  return (
    <section
      data-row-key={item.runKey}
      aria-label={countLabels.join(", ")}
      className="agent-chat-row-motion px-1 py-0.5"
    >
      {actions ? (
        <button
          ref={headerRef}
          type="button"
          aria-expanded={!item.folded}
          aria-controls={bodyId}
          className={cn("-mx-2 w-[calc(100%+1rem)]", rowClassName(false))}
          onClick={(event) => actions.toggle(item.runKey, event.currentTarget, item.folded)}
        >
          {summary}
        </button>
      ) : (
        <div className={cn("-mx-2 w-[calc(100%+1rem)]", rowClassName(null))}>{summary}</div>
      )}
      <CssPresenceReveal open={!item.folded} className="pt-0.5" motionClassName="tool-run-reveal">
        <ToolRunBody
          id={bodyId}
          item={item}
          headerRef={headerRef}
          runtimePresentation={runtimePresentation}
          workingDirectory={workingDirectory}
        />
      </CssPresenceReveal>
    </section>
  );
}, areToolRunGroupPropsEqual);

/**
 * The calls of an open run along the guide line, which runs under the kind icon of the header. A
 * long run shows its latest calls in a window of their height: a new call comes in at the bottom,
 * and the oldest shown call goes out at the top, under the bar of the earlier calls.
 */
const ToolRunBody = ({
  id,
  item,
  headerRef,
  runtimePresentation,
  workingDirectory,
}: {
  id: string;
  item: ToolRunItem;
  headerRef: RefObject<HTMLButtonElement | null>;
} & Omit<ToolRunGroupProps, "item">): ReactElement => {
  const { run, earlierCallCount, shownEarlierCount } = item;
  const listRef = useRef<HTMLUListElement>(null);
  // The calls that come after the body shows come in with motion.
  const mountCallCount = useValueAtMount(item.callCount);
  const previousCallCountRef = useRef(item.callCount);
  const showsLatestOnly = earlierCallCount > 0 && shownEarlierCount === 0;
  // The call before the latest calls, which goes out at the top when a new call comes.
  const leavingRow = showsLatestOnly ? run.rows[earlierCallCount - 1] : undefined;
  const lineProps = { runtimePresentation, workingDirectory };

  useLayoutEffect(() => {
    const addedCount = item.callCount - previousCallCountRef.current;
    previousCallCountRef.current = item.callCount;
    const list = listRef.current;
    if (!showsLatestOnly || addedCount <= 0 || !list || prefersReducedMotion()) return;
    // The first item is the call that goes out, so the shown calls move up by its height.
    const lineHeight = list.firstElementChild?.getBoundingClientRect().height ?? 0;
    // The shown calls start where they were and move up by the new calls.
    list.animate(
      [{ transform: `translateY(${addedCount * lineHeight}px)` }, { transform: "none" }],
      { duration: 240, easing: MOTION_EASE_OUT },
    );
  }, [item.callCount, showsLatestOnly]);

  return (
    <div id={id} className="ml-[6.5px] border-l border-border pl-[6.5px]">
      {earlierCallCount > 0 || shownEarlierCount > 0 ? (
        <EarlierCallsBar item={item} headerRef={headerRef} />
      ) : null}
      <div className={cn(showsLatestOnly && "overflow-y-clip")}>
        <ul ref={listRef} className="relative">
          {leavingRow ? (
            <li
              key={`${leavingRow.key}:leaving`}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 -translate-y-full"
            >
              <div className={cn(NESTED_ROW_PLACE, rowClassName(null))}>
                <ToolRunLineContent row={leavingRow} {...lineProps} />
              </div>
            </li>
          ) : null}
          {run.rows.slice(earlierCallCount).map((row, index) => (
            <ToolRunLine
              key={row.key}
              row={row}
              entersWithMotion={!showsLatestOnly && earlierCallCount + index >= mountCallCount}
              {...lineProps}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

/**
 * The bar at the top of a long open run. It shows the earlier calls that the run hides, a page at
 * a time, with the failed calls among them, so the failures that the header counts stay in view.
 * After the reader showed some, it also hides them again. The header of the run stays in place.
 */
const EarlierCallsBar = ({
  item,
  headerRef,
}: {
  item: ToolRunItem;
  headerRef: RefObject<HTMLButtonElement | null>;
}): ReactElement => {
  const actions = useContext(ToolRunActionsContext);
  const { runKey, earlierCallCount, earlierFailedCount, shownEarlierCount } = item;
  const act = (action: (header: HTMLElement) => void) => () => {
    const header = headerRef.current;
    if (header) action(header);
  };
  const showContent = (
    <>
      <ChevronsUp aria-hidden="true" className={"size-3.5 shrink-0 text-muted-foreground"} />
      <span className="min-w-0 truncate leading-5 text-muted-foreground group-hover/line:text-foreground">
        {readShowEarlierCallsLabel(earlierCallCount)}
      </span>
      {earlierFailedCount > 0 ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="shrink-0 text-[11px] text-destructive-muted">
            <span className="sr-only">, </span>
            {earlierFailedCount} failed
          </span>
        </>
      ) : null}
    </>
  );
  const hideLabel = readHideEarlierCallsLabel(shownEarlierCount);
  const hideContent = (
    <>
      <ChevronsDownUp aria-hidden="true" className={"size-3.5 shrink-0 text-muted-foreground"} />
      <span className="min-w-0 truncate leading-5 text-muted-foreground group-hover/line:text-foreground">
        {hideLabel}
      </span>
    </>
  );
  if (!actions) {
    return (
      <div className={cn(NESTED_ROW_PLACE, rowClassName(null), BAR_ROW_PADDING)}>
        {earlierCallCount > 0 ? showContent : hideContent}
      </div>
    );
  }
  const showButton =
    earlierCallCount > 0 ? (
      <button
        type="button"
        className={cn(rowClassName(false), BAR_ROW_PADDING, "min-w-0 flex-1")}
        onClick={act((header) =>
          actions.showEarlier(
            runKey,
            header,
            earlierCallCount - readEarlierCallStep(earlierCallCount),
          ),
        )}
      >
        {showContent}
      </button>
    ) : null;
  const hideButton =
    shownEarlierCount > 0 ? (
      <button
        type="button"
        className={cn(
          rowClassName(false),
          BAR_ROW_PADDING,
          showButton ? "w-auto shrink-0" : "min-w-0 flex-1",
        )}
        onClick={act((header) => actions.hideEarlier(runKey, header))}
      >
        {hideContent}
      </button>
    ) : null;
  return (
    <div className={cn(NESTED_ROW_PLACE, "flex min-w-0 items-center gap-1")}>
      {showButton}
      {hideButton}
    </div>
  );
};

const STATE_COLORS = {
  failed: "text-destructive-muted",
  cancelled: "text-cancelled-muted",
  running: "text-status-running-foreground",
} as const satisfies Record<ToolRunState["key"], string>;

const TITLE_ICONS = {
  Shell: SquareTerminal,
  Files: FileSearch,
  Web: Globe,
  Tools: Wrench,
} as const satisfies Record<ToolRunTitle, LucideIcon>;

/** The kind, the counts, and the state of a run, for its header. */
const ToolRunHeader = ({
  item,
  countLabels,
}: {
  item: ToolRunItem;
  countLabels: readonly string[];
}): ReactElement => {
  const title = readToolRunTitle(item);
  const TitleIcon = TITLE_ICONS[title];
  const states = readToolRunStates(item, item.folded);
  return (
    <>
      <TitleIcon aria-hidden="true" className={"size-3.5 shrink-0 text-muted-foreground"} />
      <span className="shrink-0 font-medium">{title}</span>
      <span className="min-w-0 truncate text-foreground/75">{countLabels.join(" · ")}</span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover/line:text-foreground motion-reduce:transition-none",
          item.folded && "-rotate-90",
        )}
      />
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px]">
        {states.map((state, index) => (
          <Fragment key={state.key}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            ) : null}
            <span className={STATE_COLORS[state.key]}>{state.label}</span>
          </Fragment>
        ))}
      </span>
    </>
  );
};

type ToolRunLineProps = {
  row: ToolRunRow;
  /** A call that comes in a run that shows comes in with a short fade and rise. */
  entersWithMotion: boolean;
  runtimePresentation: RuntimePresentation;
  workingDirectory: string | null;
};

const ToolRunLine = memo(function ToolRunLine({
  row,
  entersWithMotion,
  runtimePresentation,
  workingDirectory,
}: ToolRunLineProps): ReactElement {
  const details = useToolDetailsRow(row.message.id);
  // The line keeps the motion that it had when it mounted, so no later render starts it again.
  const enters = useValueAtMount(entersWithMotion);
  const content = (
    <ToolRunLineContent
      row={row}
      runtimePresentation={runtimePresentation}
      workingDirectory={workingDirectory}
    />
  );
  return (
    <li className={cn(enters && "tool-line-enter")}>
      {details ? (
        <button
          type="button"
          aria-pressed={details.isShown}
          className={cn(NESTED_ROW_PLACE, rowClassName(details.isShown))}
          onClick={details.onClick}
        >
          {content}
        </button>
      ) : (
        <div className={cn(NESTED_ROW_PLACE, rowClassName(null))}>{content}</div>
      )}
    </li>
  );
});

const ToolRunLineContent = ({
  row,
  runtimePresentation,
  workingDirectory,
}: Omit<ToolRunLineProps, "entersWithMotion">): ReactElement => {
  const { message } = row;
  const { meta } = message;
  const phase = getToolLifecyclePhase(meta);
  const line = readToolRunCallLine(row, runtimePresentation.presentToolCall, workingDirectory);
  // A part that a new state of the call brings fades in. A line that mounts shows at once.
  const swapIn = useChangedSinceMount(phase);
  const errorOpens = useChangedSinceMount(line.errorPreview !== null);
  const swapClassName = swapIn ? "tool-line-swap-in" : undefined;
  // The icon and the timing stay on the line of the call. The error opens under it.
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-h-[26px] min-w-0 items-center gap-2">
        <ToolCallIcon meta={meta} phase={phase} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2 leading-5">
          <span className="shrink-0 font-medium">{line.name}</span>
          {line.kind === "command" ? (
            <ShellCommandText line={line} swapClassName={swapClassName} />
          ) : (
            <ToolCallSummary line={line} swapClassName={swapClassName} />
          )}
        </span>
        {line.kind === "call" && line.changes ? (
          <FileChanges changes={line.changes} className={swapClassName} />
        ) : null}
        {phase === "cancelled" ? (
          <span className={cn("shrink-0 text-[11px] text-cancelled-muted", swapClassName)}>
            Cancelled
          </span>
        ) : null}
        <ToolMessageTiming
          activity={null}
          durationMs={getToolDuration(meta, message.timestamp)}
          timeLabel={readMessageTimeLabel(message)}
          className="ml-0 text-foreground/75"
        />
      </span>
      {line.errorPreview ? (
        // The error starts under the tool name: the 14 px icon and the 8 px gap.
        <span
          className={cn(
            "truncate pb-[3px] pl-[22px] text-[11px] leading-4 text-destructive-muted",
            errorOpens && "tool-line-error-in",
          )}
        >
          {line.errorPreview}
        </span>
      ) : null}
    </span>
  );
};

type CommandLine = Extract<ToolRunCallLine, { kind: "command" }>;
type CallLine = Extract<ToolRunCallLine, { kind: "call" }>;

/**
 * The summary of a call that is not a shell command. The file of a read or an edit shows the icon
 * of its type, as the file tree does.
 */
const ToolCallSummary = ({
  line,
  swapClassName,
}: {
  line: CallLine;
  swapClassName: string | undefined;
}): ReactElement | null => {
  if (!line.summary) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 self-center", swapClassName)}>
      {line.filePath ? <FileTypeIcon filePath={line.filePath} /> : null}
      <span className="min-w-0 truncate text-foreground/75">{line.summary}</span>
    </span>
  );
};

/** The lines that an edit added and removed, as the file edit cards show them. */
const FileChanges = ({
  changes: { additions, deletions },
  className,
}: {
  changes: NonNullable<CallLine["changes"]>;
  className: string | undefined;
}): ReactElement | null =>
  additions > 0 || deletions > 0 ? (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums",
        className,
      )}
    >
      {additions > 0 ? <span className="text-success-muted">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-destructive-muted">-{deletions}</span> : null}
    </span>
  ) : null;

/**
 * The first line of a command. The tool details give the whole command. The command fades in
 * when the agent finished writing it, and its color follows the state of the call.
 */
const ShellCommandText = ({
  line: { text, isPreparing, isMuted, extraLineCount },
  swapClassName,
}: {
  line: CommandLine;
  swapClassName: string | undefined;
}): ReactElement => {
  if (isPreparing) {
    return <span className="leading-5 text-muted-foreground">{text}</span>;
  }
  return (
    <span key="command" className={cn("flex min-w-0 items-baseline gap-2", swapClassName)}>
      <code
        className={cn(
          "min-w-0 truncate font-mono leading-5 transition-colors duration-200 motion-reduce:transition-none",
          isMuted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {text}
      </code>
      {extraLineCount > 0 ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          +{plural(extraLineCount, "line")}
        </span>
      ) : null}
    </span>
  );
};
