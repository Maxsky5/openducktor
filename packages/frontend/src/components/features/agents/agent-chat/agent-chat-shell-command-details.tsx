import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { findFailureLine } from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import {
  countTextLines,
  EMPTY_SHELL_OUTPUT,
  readCommandFolderLabel,
  readShellCommandCall,
  readEmptyShellOutput,
  readShellCommandOutput,
} from "@openducktor/frontend-core/sessions/messages/shell-command-call";
import {
  isPlainUnifiedDiff,
  parseTerminalLines,
  readDiffLineTone,
  readTerminalText,
  type TerminalColor,
  type TerminalTextSegment,
  terminalColorValue,
} from "@openducktor/frontend-core/sessions/messages/terminal-text";
import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import { ArrowDown, Folder, SquareTerminal, WrapText } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type ReactElement,
  type ReactNode,
  type RefCallback,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { plural } from "@openducktor/frontend-core/lib/plural";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DetailsCopyButton,
  DetailsHeading,
  type ToolDetailsTiming,
} from "./agent-chat-tool-details-content";

/**
 * The details of a shell command call: the program and its status, then the command as the input
 * of the call and the output as its result. Each shows under its label in a block in the colors of
 * the integrated terminal.
 */
export const ShellCommandDetails = ({
  meta,
  title,
  sessionFolder,
  closeAction,
  showsRunningOutput,
  messageTimestamp,
  timeLabel,
}: {
  meta: ToolMeta;
  /** The program and subcommand of the command, such as `biome check`. */
  title: string;
  sessionFolder: string | null;
  /** The runtime sends the output of the command while it runs, so the output shows live. */
  showsRunningOutput: boolean;
  /** The close control of details that are not a panel tab. */
  closeAction?: ReactNode;
} & ToolDetailsTiming): ReactElement => {
  // The panel is narrow, so long lines wrap until the reader turns wrap off to keep columns.
  const [wrap, setWrap] = useState(true);
  const call = readShellCommandCall(meta);
  const phase = getToolLifecyclePhase(meta);
  const { text, error, isError, message } = readShellCommandOutput(meta);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-4 pb-4">
      <DetailsHeading
        icon={<SquareTerminal />}
        title={title}
        titleClassName="font-mono"
        meta={meta}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        exitCode={call.exitCode}
        description={call.description}
        closeAction={closeAction}
      />
      <CommandSection meta={meta} sessionFolder={sessionFolder} />
      {message ? (
        <DetailsSection
          label="Message to the agent"
          actions={<DetailsCopyButton text={readTerminalText(message)} what="message" />}
        >
          <p className="rounded-lg border border-border px-3 py-2.5 text-xs leading-5 whitespace-pre-wrap text-foreground/85">
            {readTerminalText(message)}
          </p>
        </DetailsSection>
      ) : (
        <OutputSection
          text={text}
          error={error}
          isError={isError}
          phase={phase}
          isLive={phase === "executing" && showsRunningOutput}
          emptyText={readEmptyShellOutput(phase, showsRunningOutput)}
          wrap={wrap}
          onWrapChange={setWrap}
        />
      )}
    </div>
  );
};

/** The surface of the integrated terminal, for the command and its output. */
const TERMINAL_BLOCK =
  "rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-panel)] font-mono text-[12px] leading-5 text-[var(--terminal-foreground)]";

/** A part of the details: its label, its facts and actions, then its content. */
const DetailsSection = ({
  label,
  facts,
  actions,
  className,
  children,
}: {
  label: string;
  facts?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}): ReactElement => (
  <section aria-label={label} className={cn("flex shrink-0 flex-col gap-1.5", className)}>
    <div className="flex h-7 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="text-xs font-medium">{label}</h3>
        {facts}
      </div>
      {actions ? <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
    {children}
  </section>
);

/** The command of a call after a prompt, with its folder and its timeout. */
const CommandSection = ({
  meta,
  sessionFolder,
}: {
  meta: ToolMeta;
  sessionFolder: string | null;
}): ReactElement => {
  const call = readShellCommandCall(meta);
  const folder = readCommandFolderLabel(call, sessionFolder);
  return (
    <DetailsSection
      label="Command"
      className="max-h-[40%]"
      actions={call.command ? <DetailsCopyButton text={call.command} what="command" /> : null}
    >
      <div className={cn(TERMINAL_BLOCK, "flex min-h-0 gap-2 overflow-y-auto px-3 py-2.5")}>
        <span aria-hidden="true" className="shrink-0 font-semibold text-emerald-400 select-none">
          $
        </span>
        <CommandText command={call.shownCommand || EMPTY_SHELL_OUTPUT.preparing} />
      </div>
      {folder || call.timeoutMs !== null ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-muted-foreground">
          {folder ? (
            <span className="inline-flex min-w-0 items-center gap-1.5" title={folder}>
              <Folder aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">Folder</span>
              <span className="min-w-0 truncate font-mono">{folder}</span>
            </span>
          ) : null}
          {call.timeoutMs === null ? null : (
            <span className="tabular-nums">Timeout {formatAgentDuration(call.timeoutMs)}</span>
          )}
        </p>
      ) : null}
    </DetailsSection>
  );
};

/** The output of a command, with its line count and its wrap and copy actions. */
const OutputSection = ({
  text,
  error,
  isError,
  phase,
  isLive,
  emptyText,
  wrap,
  onWrapChange,
}: {
  text: string;
  /** The error of a failed command that also gave output. */
  error: string;
  isError: boolean;
  phase: ToolLifecyclePhase;
  /** The command runs, and its runtime sends its output while it runs. */
  isLive: boolean;
  /** What the output says before the command gave output. */
  emptyText: string;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
}): ReactElement => {
  const copyText = useMemo(() => (text ? readTerminalText(text) : ""), [text]);
  const lineCount = copyText ? countTextLines(copyText) : 0;
  return (
    <DetailsSection
      label="Output"
      className="min-h-0 flex-1 shrink"
      facts={
        <>
          {lineCount > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {plural(lineCount, "line")}
            </span>
          ) : null}
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-status-running-foreground">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
              />
              Live
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={wrap}
            className={cn(
              "h-6 gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground",
              wrap && "bg-muted text-foreground",
            )}
            onClick={() => onWrapChange(!wrap)}
          >
            <WrapText aria-hidden="true" className="size-3.5" />
            Wrap lines
          </Button>
          {copyText ? <DetailsCopyButton text={copyText} what="output" /> : null}
        </>
      }
    >
      <CommandOutput
        text={text}
        error={error}
        isError={isError}
        phase={phase}
        isLive={isLive}
        emptyText={emptyText}
        wrap={wrap}
      />
    </DetailsSection>
  );
};

// The output shows on the surface of the integrated terminal, so it takes the terminal colors.

const segmentStyle = (segment: TerminalTextSegment): CSSProperties | undefined => {
  if (!segment.fg && !segment.bg) return undefined;
  return {
    color: segment.fg ? terminalColorValue(segment.fg) : undefined,
    backgroundColor: segment.bg ? terminalColorValue(segment.bg) : undefined,
  };
};

const isPlainSegment = (segment: TerminalTextSegment): boolean =>
  !segment.fg &&
  !segment.bg &&
  !segment.bold &&
  !segment.dim &&
  !segment.italic &&
  !segment.underline &&
  !segment.strikethrough;

const OutputSegment = ({ segment }: { segment: TerminalTextSegment }): ReactNode =>
  isPlainSegment(segment) ? (
    segment.text
  ) : (
    <span
      style={segmentStyle(segment)}
      className={cn(
        segment.bold && "font-semibold",
        segment.dim && "opacity-60",
        segment.italic && "italic",
        segment.underline && "underline",
        segment.strikethrough && "line-through",
      )}
    >
      {segment.text}
    </span>
  );

/** The wrapped part of a line indents at most this many columns. */
const MAX_WRAP_INDENT_COLUMNS = 24;

/**
 * The indent of the wrapped part of a line: two columns past the leading spaces of the line, as
 * in an editor. A wrapped line of a code frame then stays under its own text.
 */
const wrapIndent = (line: string): string => {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += 8 - (columns % 8);
    else break;
  }
  return `${Math.min(columns, MAX_WRAP_INDENT_COLUMNS) + 2}ch`;
};

/** The marked failure line reaches into the padding, so its rule stays clear of its text. */
const FAILURE_LINE_GUTTER = "8px";

const lineStyle = (indent: string | null, isFailureLine: boolean): CSSProperties | undefined => {
  const wrapStyle = indent ? { paddingLeft: indent, textIndent: `-${indent}` } : undefined;
  if (!isFailureLine) return wrapStyle;
  return {
    ...wrapStyle,
    marginInline: `-${FAILURE_LINE_GUTTER}`,
    paddingLeft: `calc(${indent ?? "0px"} + ${FAILURE_LINE_GUTTER})`,
    paddingRight: FAILURE_LINE_GUTTER,
  };
};

/** A long output shows its last lines until the reader asks for all of them. */
const SHOWN_OUTPUT_LINE_COUNT = 1_000;

/** Where the last `count` lines of a text start, or 0 when the text has no more lines. */
const startOfLastLines = (text: string, count: number): number => {
  // A last line break does not start a line.
  let start = text.endsWith("\n") ? text.length - 1 : text.length;
  for (let line = 0; line < count; line += 1) {
    const lineBreak = text.lastIndexOf("\n", start - 1);
    if (lineBreak < 0) return 0;
    start = lineBreak;
  }
  return start + 1;
};

const countLineBreaks = (text: string, end: number): number => {
  let count = 0;
  for (
    let index = text.indexOf("\n");
    index >= 0 && index < end;
    index = text.indexOf("\n", index + 1)
  ) {
    count += 1;
  }
  return count;
};

type OutputRun = { segment: TerminalTextSegment; key: string };
type OutputLineModel = { key: string; indent: string; runs: OutputRun[] };

const isSameColor = (left: TerminalColor | null, right: TerminalColor | null): boolean =>
  left === right ||
  (left !== null && right !== null && terminalColorValue(left) === terminalColorValue(right));

const isSameSegment = (left: TerminalTextSegment, right: TerminalTextSegment): boolean =>
  left.text === right.text &&
  isSameColor(left.fg, right.fg) &&
  isSameColor(left.bg, right.bg) &&
  left.bold === right.bold &&
  left.dim === right.dim &&
  left.italic === right.italic &&
  left.underline === right.underline &&
  left.strikethrough === right.strikethrough;

type OutputLineProps = {
  line: OutputLineModel;
  wrap: boolean;
  isFailureLine: boolean;
  /** The output grows while the command runs, and this line is its last line. */
  hasCursor: boolean;
};

// Each update of a running command parses its output again, so a line that did not change
// compares equal and does not render again.
const isSameOutputLine = (left: OutputLineProps, right: OutputLineProps): boolean =>
  left.wrap === right.wrap &&
  left.isFailureLine === right.isFailureLine &&
  left.hasCursor === right.hasCursor &&
  left.line.indent === right.line.indent &&
  left.line.runs.length === right.line.runs.length &&
  left.line.runs.every((run, index) => {
    const other = right.line.runs[index];
    return other !== undefined && isSameSegment(run.segment, other.segment);
  });

const OutputLine = memo(function OutputLine({
  line,
  wrap,
  isFailureLine,
  hasCursor,
}: OutputLineProps): ReactElement {
  return (
    <div
      style={lineStyle(wrap ? line.indent : null, isFailureLine)}
      {...(isFailureLine
        ? {
            "data-failure-line": true,
            className: "bg-red-500/10 text-red-200 shadow-[inset_2px_0_0_var(--color-red-400)]",
          }
        : {})}
    >
      {line.runs.length === 0 ? "​" : null}
      {line.runs.map(({ segment, key }) => (
        <OutputSegment key={key} segment={segment} />
      ))}
      {hasCursor ? <OutputCursor /> : null}
    </div>
  );
}, isSameOutputLine);

/**
 * Command output, one block per line, with the colors and styles that the command wrote. Without
 * wrap, long lines scroll sideways, so code frames and tables keep their columns. The line that
 * says why a command failed shows marked, with its rule in the padding left of the text. A long
 * output shows its last lines, which hold its result, until the reader asks for all of them.
 */
const OutputLines = ({
  text,
  wrap,
  isLive,
  failureLine,
}: {
  text: string;
  wrap: boolean;
  isLive: boolean;
  /** The index of the failure line among all the lines of the text. */
  failureLine: number | null;
}): ReactElement => {
  const [showsAll, setShowsAll] = useState(false);
  // A plain diff, as `git show` prints it, gets the colors that `git` gives it in a terminal.
  const { lines, hiddenLineCount } = useMemo(() => {
    const start = showsAll ? 0 : startOfLastLines(text, SHOWN_OUTPUT_LINE_COUNT);
    const isDiff = isPlainUnifiedDiff(text);
    // The text of a line keys it, so the lines that stay keep their blocks when a running output
    // drops its first lines.
    const occurrences = new Map<string, number>();
    const parsed = parseTerminalLines(start === 0 ? text : text.slice(start)).map(
      (runs): OutputLineModel => {
        const lineText = runs.map((run) => run.text).join("");
        const occurrence = occurrences.get(lineText) ?? 0;
        occurrences.set(lineText, occurrence + 1);
        const tone = isDiff ? readDiffLineTone(lineText) : null;
        return {
          key: `${occurrence}:${lineText}`,
          indent: wrapIndent(lineText),
          runs: runs.map((segment, run) => ({
            segment: tone
              ? { ...segment, fg: { kind: "tone" as const, tone, bright: false } }
              : segment,
            key: `run-${run}`,
          })),
        };
      },
    );
    return { lines: parsed, hiddenLineCount: start === 0 ? 0 : countLineBreaks(text, start) };
  }, [text, showsAll]);
  const lastLine = lines.length - 1;
  return (
    <>
      {hiddenLineCount > 0 ? (
        <button
          type="button"
          className="mb-1.5 rounded-sm font-sans text-[11px] font-medium text-[var(--terminal-muted)] underline-offset-2 outline-none hover:text-[var(--terminal-foreground)] hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowsAll(true)}
        >
          {`Show ${plural(hiddenLineCount, "earlier line")}`}
        </button>
      ) : null}
      <div
        className={
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "w-max min-w-full whitespace-pre"
        }
      >
        {lines.map((line, index) => (
          <OutputLine
            key={line.key}
            line={line}
            wrap={wrap}
            isFailureLine={failureLine !== null && index === failureLine - hiddenLineCount}
            hasCursor={isLive && index === lastLine}
          />
        ))}
      </div>
    </>
  );
};

const OutputCursor = (): ReactElement => (
  <span
    aria-hidden="true"
    className="ml-0.5 inline-block h-[1.1em] w-[0.55em] translate-y-[0.18em] bg-foreground/60 motion-safe:animate-pulse"
  />
);

/** A command shows its first lines until the reader asks for all of it. */
const COMMAND_CLAMP_CLASS = "line-clamp-4";

/** The command of a call. A long command shows its first lines and a control for the rest. */
const CommandText = ({ command }: { command: string }): ReactElement => {
  const [isOpen, setOpen] = useState(false);
  const clamp = useIsClamped(command);
  return (
    <div className="min-w-0 flex-1">
      <pre
        ref={clamp.ref}
        className={cn(
          "m-0 font-mono text-[12px] leading-5 whitespace-pre-wrap text-[var(--terminal-foreground)] [overflow-wrap:anywhere]",
          !isOpen && COMMAND_CLAMP_CLASS,
        )}
      >
        {command}
      </pre>
      {isOpen || clamp.isClamped ? (
        <button
          type="button"
          aria-expanded={isOpen}
          className="mt-1 rounded-sm font-sans text-[11px] font-medium text-[var(--terminal-muted)] underline-offset-2 outline-none hover:text-[var(--terminal-foreground)] hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((value) => !value)}
        >
          {isOpen ? "Show less" : "Show the full command"}
        </button>
      ) : null}
    </div>
  );
};

/** The element to measure, and whether it shows less than all of its text. */
type ClampMeasure = { ref: RefCallback<HTMLElement>; isClamped: boolean };

/**
 * Whether the clamped element shows less than all of its text. It measures again when the text or
 * the width of the element changes.
 */
const useIsClamped = (text: string): ClampMeasure => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isClamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = (): void => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);
  return { ref: setElement, isClamped };
};

/** The space under the end of the output that still counts as reading the end. */
const OUTPUT_END_THRESHOLD_PX = 24;

/** Where the reader is in the output: at its end, after its start, and before its right edge. */
type OutputScroll = { isAtEnd: boolean; hasMoreAbove: boolean; hasMoreRight: boolean };

const readOutputScroll = (region: HTMLElement): OutputScroll => ({
  isAtEnd: region.scrollHeight - region.scrollTop - region.clientHeight <= OUTPUT_END_THRESHOLD_PX,
  hasMoreAbove: region.scrollTop > 1,
  hasMoreRight: region.scrollWidth - region.scrollLeft - region.clientWidth > 1,
});

const isSameOutputScroll = (current: OutputScroll, next: OutputScroll): boolean =>
  current.isAtEnd === next.isAtEnd &&
  current.hasMoreAbove === next.hasMoreAbove &&
  current.hasMoreRight === next.hasMoreRight;

type OutputScrollControl = {
  regionRef: RefObject<HTMLDivElement | null>;
  scroll: OutputScroll;
  onScroll: (region: HTMLElement) => void;
  scrollToEnd: () => void;
};

/**
 * The scroll place of the output. The output opens at its end, where commands print their result
 * and their errors. While the reader stays at the end, new output, a full output that replaces the
 * running output, and a change of layout keep the end in view.
 */
const useOutputScroll = ({ text, wrap }: { text: string; wrap: boolean }): OutputScrollControl => {
  const regionRef = useRef<HTMLDivElement>(null);
  const isAtEndRef = useRef(true);
  const [scroll, setScroll] = useState<OutputScroll>({
    isAtEnd: true,
    hasMoreAbove: false,
    hasMoreRight: false,
  });
  const onScroll = useCallback((region: HTMLElement): void => {
    const next = readOutputScroll(region);
    isAtEndRef.current = next.isAtEnd;
    setScroll((current) => (isSameOutputScroll(current, next) ? current : next));
  }, []);
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    if (isAtEndRef.current) region.scrollTop = region.scrollHeight;
    onScroll(region);
  }, [text, wrap, onScroll]);
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    // A wider or narrower panel changes the height of the lines and which lines go past the right
    // edge.
    const observer = new ResizeObserver(() => {
      if (isAtEndRef.current) region.scrollTop = region.scrollHeight;
      onScroll(region);
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, [onScroll]);
  const scrollToEnd = useCallback((): void => {
    const region = regionRef.current;
    if (region) region.scrollTop = region.scrollHeight;
  }, []);
  return { regionRef, scroll, onScroll, scrollToEnd };
};

/**
 * The output of a command, which scrolls under the command. Fades show that lines go on above and
 * past the right edge. The output of a failed command marks the line that says why it failed.
 */
const CommandOutput = ({
  text,
  error,
  isError,
  phase,
  isLive,
  emptyText,
  wrap,
}: {
  text: string;
  /** The error of a failed command that also gave output, which shows first, as stderr. */
  error: string;
  /** The text is the error of a command that gave no output. */
  isError: boolean;
  phase: ToolLifecyclePhase;
  isLive: boolean;
  emptyText: string;
  wrap: boolean;
}): ReactElement => {
  // The cursor marks output that grows while the command runs.
  const follow = isLive;
  const failureLine = useMemo(
    () => (phase === "failed" && text ? findFailureLine(readTerminalText(text)) : null),
    [phase, text],
  );
  const { regionRef, scroll, onScroll, scrollToEnd } = useOutputScroll({ text, wrap });
  const cursor = follow ? <OutputCursor /> : null;
  return (
    <div className={cn(TERMINAL_BLOCK, "relative flex min-h-0 flex-1 flex-col overflow-hidden")}>
      <div
        ref={regionRef}
        role="region"
        aria-label="Command output"
        tabIndex={0}
        onScroll={(event) => onScroll(event.currentTarget)}
        className={cn(
          "relative min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2.5 outline-none [scrollbar-color:var(--terminal-border)_transparent] [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          isError
            ? "text-red-300"
            : "text-[color-mix(in_oklch,var(--terminal-foreground)_86%,transparent)]",
        )}
      >
        {error ? (
          <p className="mb-2 whitespace-pre-wrap text-red-300 [overflow-wrap:anywhere]">
            {readTerminalText(error)}
          </p>
        ) : null}
        {text ? (
          <OutputLines
            text={text}
            wrap={wrap}
            isLive={follow}
            failureLine={failureLine?.index ?? null}
          />
        ) : null}
        {!text ? (
          <p className="font-sans text-xs leading-5 text-[var(--terminal-muted)]">
            {emptyText}
            {cursor}
          </p>
        ) : null}
      </div>
      {scroll.hasMoreAbove ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-[var(--terminal-panel)] to-transparent"
        />
      ) : null}
      {scroll.hasMoreRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--terminal-panel)] to-transparent"
        />
      ) : null}
      {scroll.isAtEnd ? null : (
        <button
          type="button"
          aria-label={follow ? "Show the latest output" : "Show the end of the output"}
          title={follow ? "Latest output" : "End of output"}
          className="absolute right-3 bottom-3 inline-flex size-8 items-center justify-center rounded-full border border-white/15 bg-[var(--terminal-tab-inactive)] text-[var(--terminal-foreground)] shadow-lg outline-none hover:bg-[var(--terminal-border)] focus-visible:ring-2 focus-visible:ring-ring"
          onClick={scrollToEnd}
        >
          <ArrowDown aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
};
