import { getSessionMessages } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { readMessageTimeLabel } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import { readToolDetailsHeading } from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { OdtToolIconKind } from "@openducktor/frontend-core/sessions/messages/odt-tool-call";
import {
  isShellCommandCall,
  readShellCommandCall,
  readShellCommandName,
} from "@openducktor/frontend-core/sessions/messages/shell-command-call";
import { ToolPartSessionContext } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { X } from "lucide-react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { FileEditDetails } from "./agent-chat-file-edit-details";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { ShellCommandDetails } from "./agent-chat-shell-command-details";
import { ToolCallDetails } from "./agent-chat-tool-details-content";
import {
  type ToolDetailsState,
  type ToolDetailsStore,
  useToolDetailsState,
} from "./agent-chat-tool-details-store";
import { toolIcon } from "./agent-chat-tool-icon";
import { FullToolPartDetails } from "./agent-chat-tool-part-details";

type ShownToolCall = {
  message: AgentChatMessage;
  meta: ToolMeta;
  isShell: boolean;
  /** The program and subcommand of a shell command, or else the title of the call. */
  title: string;
  /** The icon of an ODT tool, or null for the icon of the tool type. */
  iconKind: OdtToolIconKind | null;
  /** The Markdown note of a workflow event. */
  note: string | null;
};

// The panel tab and the page read the shown call of the same state, so each state finds it once.
const shownToolCalls = new WeakMap<ToolDetailsState, ShownToolCall | null>();

/** The shown call, live. Recent calls are near the end of the transcript, so it looks there first. */
const findShownToolCall = (state: ToolDetailsState): ShownToolCall | null => {
  const known = shownToolCalls.get(state);
  if (known !== undefined) return known;
  const shown = readShownToolCall(state);
  shownToolCalls.set(state, shown);
  return shown;
};

const readShownToolCall = (state: ToolDetailsState): ShownToolCall | null => {
  const { messageId, session, source } = state;
  if (messageId === null || !session || !source) return null;
  const message = getSessionMessages(session).findLast((item) => item.id === messageId);
  if (message?.meta?.kind !== "tool") return null;
  const { meta } = message;
  if (isShellCommandCall(meta)) {
    const title = readShellCommandName(readShellCommandCall(meta).shownCommand);
    return { message, meta, isShell: true, title, iconKind: null, note: null };
  }
  const heading = readToolDetailsHeading(
    meta,
    source.runtimePresentation.presentToolCall(meta.tool, meta.displayLabel),
  );
  return { message, meta, isShell: false, ...heading };
};

/** Closes the details, and gives the keyboard focus back to the row that showed them. */
const closeDetails = (store: ToolDetailsStore): void => {
  const { trigger } = store.read();
  store.close();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
};

/** The details of the shown call. The full call loads first when the history cut its details. */
const ToolCallDetailsBody = ({
  state,
  shown,
  closeAction,
}: {
  state: ToolDetailsState;
  shown: ShownToolCall;
  closeAction?: ReactNode;
}): ReactElement => {
  const { message, meta, isShell, title, iconKind, note } = shown;
  const timing = { messageTimestamp: message.timestamp, timeLabel: readMessageTimeLabel(message) };
  const sessionFolder = state.source?.workingDirectory ?? null;
  const renderDetails = (shownMeta: ToolMeta): ReactNode => {
    if (isShell) {
      return (
        <ShellCommandDetails
          meta={shownMeta}
          title={title}
          sessionFolder={sessionFolder}
          showsRunningOutput={
            state.source?.runtimePresentation.supportsRunningCommandOutput ?? false
          }
          closeAction={closeAction}
          {...timing}
        />
      );
    }
    if (shownMeta.toolType === "file_edit") {
      return (
        <FileEditDetails
          meta={shownMeta}
          title={title}
          workingDirectory={sessionFolder}
          closeAction={closeAction}
          {...timing}
        />
      );
    }
    return (
      <ToolCallDetails
        meta={shownMeta}
        title={title}
        icon={toolIcon(shownMeta, iconKind)}
        note={note}
        workingDirectory={sessionFolder}
        closeAction={closeAction}
        {...timing}
      />
    );
  };
  // The panel is outside the chat, so it gives the chat settings of the transcript of the call.
  return (
    <AgentChatSettingsProvider value={state.source?.chatSettings ?? null}>
      <ToolPartSessionContext value={state.source?.toolPartSession ?? null}>
        {meta.detailsOmitted ? (
          <FullToolPartDetails meta={meta} fallbackClassName="px-4 py-3">
            {renderDetails}
          </FullToolPartDetails>
        ) : (
          renderDetails(meta)
        )}
      </ToolPartSessionContext>
    </AgentChatSettingsProvider>
  );
};

const MissingToolCall = (): ReactElement => (
  <p className="px-4 py-6 text-center text-xs leading-5 text-muted-foreground">
    This tool call is not in the transcript any more.
  </p>
);

/** The details of the shown call in the tool call tab of the right panel. */
export function ToolCallPanelTabContent({ store }: { store: ToolDetailsStore }): ReactElement {
  const state = useToolDetailsState(store);
  const shown = findShownToolCall(state);
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {shown ? (
        <ToolCallDetailsBody key={shown.message.id} state={state} shown={shown} />
      ) : (
        <MissingToolCall />
      )}
    </div>
  );
}

const readRevealRevision = (state: ToolDetailsState): number | null =>
  state.messageId === null ? null : state.revision;
const readShownTitle = (state: ToolDetailsState): string | null =>
  findShownToolCall(state)?.title ?? null;
const readShownIsShell = (state: ToolDetailsState): boolean | null =>
  findShownToolCall(state)?.isShell ?? null;

/** The shown call of a store, as the tab of a page shows it. */
export type ShownToolCallTab = {
  /** A new value for each call that a press shows, or null while no call shows. */
  revealRevision: number | null;
  /** The tool name, or the program and subcommand of a shell command. */
  title: string | null;
  isShell: boolean | null;
  close: () => void;
};

/**
 * The shown call of a store, for the tab of a page that shows it. The page renders again only when
 * a call shows or closes, or when its title changes, not on each streamed change of the call. The
 * tab content follows the live call, so a running command shows each output update.
 */
export const useShownToolCallTab = (store: ToolDetailsStore): ShownToolCallTab => {
  const read =
    <Value,>(select: (state: ToolDetailsState) => Value) =>
    () =>
      select(store.read());
  const revealRevision = useSyncExternalStore(
    store.subscribe,
    read(readRevealRevision),
    read(readRevealRevision),
  );
  const title = useSyncExternalStore(store.subscribe, read(readShownTitle), read(readShownTitle));
  const isShell = useSyncExternalStore(
    store.subscribe,
    read(readShownIsShell),
    read(readShownIsShell),
  );
  const close = useCallback(() => closeDetails(store), [store]);
  return { revealRevision, title, isShell, close };
};

/** An editor outside the details, such as the composer, uses Escape itself, as to close its menus. */
const isEditorOutside = (target: EventTarget | null, details: HTMLElement | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement) &&
  !details?.contains(target);

/**
 * The details of the shown call beside the transcript, for a transcript without session panels,
 * such as the transcript of a Subagent in a dialog. The transcript gets narrower, so the details
 * cover none of its rows.
 */
export function AgentChatToolDetailsBeside({
  store,
}: {
  store: ToolDetailsStore;
}): ReactElement | null {
  const state = useToolDetailsState(store);
  const detailsRef = useRef<HTMLElement>(null);
  if (state.messageId === null) return null;
  const shown = findShownToolCall(state);
  const closeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      aria-label="Close tool details"
      onClick={() => closeDetails(store)}
    >
      <X aria-hidden="true" className="size-4" />
    </Button>
  );
  return (
    // As the newest Radix layer, the details get Escape before a dialog that holds the transcript,
    // so Escape closes the details and keeps the dialog. The details stay open on outside presses.
    <DismissableLayer
      asChild
      onEscapeKeyDown={(event) => {
        if (isEditorOutside(event.target, detailsRef.current)) return;
        event.preventDefault();
        closeDetails(store);
      }}
    >
      <aside
        ref={detailsRef}
        aria-label={shown ? `${shown.title} details` : "Tool call details"}
        className="flex min-h-0 w-[min(520px,48%)] shrink-0 flex-col border-l border-border bg-card"
      >
        {shown ? (
          <ToolCallDetailsBody
            key={shown.message.id}
            state={state}
            shown={shown}
            closeAction={closeButton}
          />
        ) : (
          <div className="flex items-start justify-between gap-2 py-1 pr-2.5 pl-1">
            <MissingToolCall />
            {closeButton}
          </div>
        )}
      </aside>
    </DismissableLayer>
  );
}
