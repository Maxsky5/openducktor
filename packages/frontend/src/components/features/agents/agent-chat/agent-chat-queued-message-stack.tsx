import type { AgentQueuedMessage, AgentSessionUserMessagePart } from "@openducktor/contracts";
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  LoaderCircle,
  Paperclip,
  Pause,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { CssPresenceList, useCssPresence } from "@/components/ui/css-presence";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentChatMessageQueueAction } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { toTranscriptAttachment } from "./agent-chat-attachments";
import {
  type QueuedMessageSteerContext,
  queuedMessageSteerBlockedReason,
} from "./agent-chat-steering";
import {
  isUserMessageReferencePart,
  renderUserMessageReferenceChip,
} from "./agent-chat-user-message-reference-chip";

export type QueuedMessageEntryAction = Exclude<AgentChatMessageQueueAction, { kind: "resume" }>;

/** A message in the stack. A message that the user edits leaves the stack for its edit card. */
export type StackedQueuedMessage = Exclude<AgentQueuedMessage, { state: "editing" }>;

type StackCssVariables = { "--queue-count": number };
type CardCssVariables = { "--queue-depth": number };

const stackStyle = (count: number): CSSProperties & StackCssVariables => ({
  "--queue-count": count,
});
const cardStyle = (depth: number): CSSProperties & CardCssVariables => ({
  "--queue-depth": depth,
});

/** A short rest opens the stack, so a pointer that only crosses it does not fan it out. */
const OPEN_DELAY_MS = 100;
/** A short grace keeps the stack open when the pointer slips past its edge. */
const CLOSE_DELAY_MS = 180;
/** Matches `--queue-close`: the whole messages stay until the cards have shrunk back. */
const SHRINK_MS = 250;

/**
 * Queued messages stacked on the top edge of the composer, newest in front. A closed stack shows
 * the start of the front message. A short hover or keyboard focus fans the stack out and shows
 * every message in full. The card under the pointer shows its actions.
 */
export function QueuedMessageStack({
  entries,
  isPaused,
  steerContext,
  pendingSubmissionId,
  onAction,
}: {
  /** In delivery order: the first entry goes out first. */
  entries: readonly StackedQueuedMessage[];
  isPaused: boolean;
  steerContext: QueuedMessageSteerContext;
  pendingSubmissionId: string | null;
  onAction: (action: QueuedMessageEntryAction) => void;
}): ReactElement {
  const hover = useDelayedFlag(OPEN_DELAY_MS, CLOSE_DELAY_MS);
  const [hasKeyboardFocus, setKeyboardFocus] = useState(false);
  const count = entries.length;
  const isSpread = hover.value || hasKeyboardFocus;
  const showsFull = useLingeringFlag(isSpread, SHRINK_MS);
  const onFocus = (event: FocusEvent<HTMLOListElement>): void => {
    if (event.target.matches(":focus-visible")) setKeyboardFocus(true);
  };
  const onBlur = (event: FocusEvent<HTMLOListElement>): void => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
      setKeyboardFocus(false);
  };
  return (
    <div
      className="queued-message-stack mx-(--queue-stack-inset)"
      data-count={count}
      data-spread={isSpread}
      style={stackStyle(count)}
    >
      {/*
       * The list grows upward over the transcript. Its box also covers the gaps between cards.
       * An empty list stays mounted, so the last card can shrink out.
       */}
      <ol
        aria-label="Queued messages"
        aria-hidden={count === 0 ? true : undefined}
        className="queued-message-stack-list"
        onPointerEnter={hover.raise}
        onPointerLeave={hover.lower}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <CssPresenceList>
          {entries.map((entry, index) => (
            <QueuedMessageCard
              key={entry.submissionId}
              entry={entry}
              depth={count - 1 - index}
              count={count}
              isPaused={isPaused}
              showsFull={showsFull}
              steerContext={steerContext}
              isPending={pendingSubmissionId === entry.submissionId}
              onAction={onAction}
            />
          ))}
        </CssPresenceList>
      </ol>
    </div>
  );
}

/** A flag that turns on and off after a delay. A new change cancels the pending one. */
function useDelayedFlag(raiseDelayMs: number, lowerDelayMs: number) {
  const [value, setValue] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback((next: boolean, delayMs: number): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setValue(next);
    }, delayMs);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return {
    value,
    raise: () => schedule(true, raiseDelayMs),
    lower: () => schedule(false, lowerDelayMs),
  };
}

/** A flag that turns on at once and stays on for a while after its source turns off. */
function useLingeringFlag(source: boolean, lingerMs: number): boolean {
  const [lingers, setLingers] = useState(source);
  if (source && !lingers) setLingers(true);
  useEffect(() => {
    if (source) return;
    const timer = setTimeout(() => setLingers(false), lingerMs);
    return () => clearTimeout(timer);
  }, [source, lingerMs]);
  return source || lingers;
}

function QueuedMessageCard({
  entry,
  depth,
  count,
  isPaused,
  showsFull,
  steerContext,
  isPending,
  onAction,
}: {
  entry: StackedQueuedMessage;
  /** 0 is the front card, the newest message. */
  depth: number;
  count: number;
  isPaused: boolean;
  /** The stack is open, or closes: the card shows its whole message. */
  showsFull: boolean;
  steerContext: QueuedMessageSteerContext;
  isPending: boolean;
  onAction: (action: QueuedMessageEntryAction) => void;
}): ReactElement {
  const { presenceProps } = useCssPresence();
  const attachmentCount = entry.parts.filter((part) => part.kind === "attachment").length;
  return (
    <li
      {...presenceProps}
      className="queued-message-card"
      data-depth={depth}
      data-buried={depth > 2}
      aria-busy={isPending || entry.state !== "queued" ? true : undefined}
      style={cardStyle(depth)}
    >
      {/* A dashed outline and muted text mark a message that the agent has not received yet. */}
      <div className="queued-message-card-surface flex items-start gap-2 rounded-xl border border-dashed border-input bg-chat-surface px-3 py-2 text-[13px] leading-5 text-muted-foreground shadow-xs">
        <div className="queued-message-card-content flex min-w-0 flex-1 items-start gap-2">
          <span className="flex h-5 shrink-0 items-center">
            <QueuedMessageGlyph entry={entry} isPaused={isPaused} />
          </span>
          <QueuedMessageBody parts={entry.parts} showsFull={showsFull} />
          {attachmentCount > 0 && !showsFull ? (
            <span
              className="inline-flex h-5 shrink-0 items-center gap-0.5 text-[11px]"
              aria-label={`${attachmentCount} ${attachmentCount === 1 ? "attachment" : "attachments"}`}
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {attachmentCount}
            </span>
          ) : null}
        </div>
        <QueuedMessageTrailing
          entry={entry}
          count={count}
          isFront={depth === 0}
          steerBlockedReason={queuedMessageSteerBlockedReason(entry, steerContext)}
          isPending={isPending}
          onAction={onAction}
        />
      </div>
    </li>
  );
}

/** What happens to the message: it waits, it is on its way, or something needs the user. */
function QueuedMessageGlyph({
  entry,
  isPaused,
}: {
  entry: AgentQueuedMessage;
  isPaused: boolean;
}): ReactElement {
  const glyph = glyphFor(entry, isPaused);
  if (!entry.error) return glyph;
  // One line has no room for the error, so the glyph shows it on hover. Screen readers hear it.
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{glyph}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-sm">
          {entry.error}
        </TooltipContent>
      </Tooltip>
      <span className="sr-only" role="alert">
        {entry.error}
      </span>
    </>
  );
}

const glyphFor = (entry: AgentQueuedMessage, isPaused: boolean): ReactElement => {
  const className = "size-3.5 shrink-0";
  if (entry.state === "sending" || entry.state === "steering")
    return <LoaderCircle className={cn(className, "animate-spin")} aria-hidden="true" />;
  if (entry.state === "acceptance_unknown")
    return (
      <AlertTriangle
        className={cn(className, "text-amber-600 dark:text-amber-400")}
        aria-hidden="true"
      />
    );
  if (entry.error)
    return (
      <AlertCircle
        className={cn(className, "text-rose-600 dark:text-rose-400")}
        aria-hidden="true"
      />
    );
  const Glyph = isPaused ? Pause : Clock3;
  return <Glyph className={className} aria-hidden="true" />;
};

/** Keys by part kind and occurrence, because message parts have no stable ID of their own. */
const keyedParts = (
  parts: readonly AgentSessionUserMessagePart[],
): Array<{ key: string; part: AgentSessionUserMessagePart }> => {
  const occurrences = new Map<string, number>();
  return parts.map((part) => {
    const occurrence = (occurrences.get(part.kind) ?? 0) + 1;
    occurrences.set(part.kind, occurrence);
    return { key: `${part.kind}-${occurrence}`, part };
  });
};

/** Text and commands read as in the transcript. References use the transcript chips, made small. */
const renderInlinePart = (
  key: string,
  part: Exclude<AgentSessionUserMessagePart, { kind: "attachment" }>,
): ReactElement => {
  if (isUserMessageReferencePart(part)) {
    return renderUserMessageReferenceChip(part, key, "compact");
  }
  return <span key={key}>{part.kind === "text" ? part.text : `/${part.command.trigger}`}</span>;
};

/** The start of the message on one line, or the whole message with its attachments. */
function QueuedMessageBody({
  parts,
  showsFull,
}: {
  parts: readonly AgentSessionUserMessagePart[];
  showsFull: boolean;
}): ReactElement {
  const inline: ReactNode[] = [];
  const attachments: ReactElement[] = [];
  const attachmentNames: string[] = [];
  for (const { key, part } of keyedParts(parts)) {
    if (part.kind !== "attachment") {
      inline.push(renderInlinePart(key, part));
      continue;
    }
    attachmentNames.push(part.attachment.name);
    attachments.push(
      <AgentChatAttachmentChip
        key={key}
        variant="transcript"
        attachment={toTranscriptAttachment(part.attachment)}
        className="w-32"
      />,
    );
  }
  return (
    <div className="min-w-0 flex-1">
      {/* A long message scrolls inside its card, so the open stack stays inside the chat. */}
      <p
        className={
          showsFull
            ? "max-h-30 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words"
            : "truncate"
        }
      >
        {inline.length > 0 ? inline : attachmentNames.join(", ")}
      </p>
      {showsFull && attachments.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">{attachments}</div>
      ) : null}
    </div>
  );
}

const DELIVERY_LABELS = {
  sending: "Sending…",
  steering: "Steering…",
  acceptance_unknown: "Delivery unknown",
} satisfies Record<Exclude<StackedQueuedMessage["state"], "queued">, string>;

/**
 * The count of the stack on the front card while it is closed, and the actions of the card under
 * the pointer when it is open. A message on its way shows its state, because nobody can change it.
 */
function QueuedMessageTrailing({
  entry,
  count,
  isFront,
  steerBlockedReason,
  isPending,
  onAction,
}: {
  entry: StackedQueuedMessage;
  count: number;
  isFront: boolean;
  steerBlockedReason: string | null;
  isPending: boolean;
  onAction: (action: QueuedMessageEntryAction) => void;
}): ReactElement {
  if (entry.state !== "queued") {
    return (
      <span className="queued-message-card-trailing h-5 shrink-0 text-[11px] font-medium">
        {DELIVERY_LABELS[entry.state]}
      </span>
    );
  }
  return (
    <div className="queued-message-card-trailing h-5 shrink-0">
      {isFront ? (
        <span className="queued-message-card-count text-[11px] font-medium" aria-hidden="true">
          {count > 1 ? `${count} queued` : "Queued"}
        </span>
      ) : null}
      <QueuedMessageActions
        entry={entry}
        steerBlockedReason={steerBlockedReason}
        isPending={isPending}
        onAction={onAction}
      />
    </div>
  );
}

function QueuedMessageActions({
  entry,
  steerBlockedReason,
  isPending,
  onAction,
}: {
  entry: AgentQueuedMessage;
  steerBlockedReason: string | null;
  isPending: boolean;
  onAction: (action: QueuedMessageEntryAction) => void;
}): ReactElement {
  const { submissionId } = entry;
  const reasonId = useId();
  return (
    <div className="queued-message-card-actions -my-0.5 flex items-center gap-0.5">
      <CardIconButton
        label="Steer now"
        hint={steerBlockedReason ?? "Send this message to the running work now"}
        describedBy={steerBlockedReason ? reasonId : undefined}
        disabled={isPending || steerBlockedReason !== null}
        onClick={() => onAction({ kind: "steer", submissionId })}
      >
        <Zap className="size-3.5" aria-hidden="true" />
      </CardIconButton>
      {steerBlockedReason ? (
        <span id={reasonId} className="sr-only">
          {steerBlockedReason}
        </span>
      ) : null}
      <CardIconButton
        label="Edit queued message"
        disabled={isPending}
        onClick={() => onAction({ kind: "begin_edit", submissionId })}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </CardIconButton>
      <CardIconButton
        label="Remove queued message"
        disabled={isPending}
        onClick={() => onAction({ kind: "remove", submissionId })}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </CardIconButton>
    </div>
  );
}

/** An icon button whose tooltip names its action. A disabled button explains why. */
function CardIconButton({
  label,
  hint = label,
  describedBy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  describedBy?: string | undefined;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so the wrapper shows the tooltip. */}
        <span className="inline-flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={label}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}
