import type { HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import {
  type AgentChatDraftStore,
  ChatDraftTooLargeError,
  createAgentChatDraftStore,
} from "../drafts/agent-chat-draft-store";
import { AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES } from "../drafts/agent-chat-draft-storage";
import {
  createQueuedMessageEditDrafts,
  type QueuedMessageEditDrafts,
} from "../drafts/agent-chat-queued-message-drafts";
import {
  createInlineCommentDraftStore,
  type InlineCommentDraftStoreApi,
} from "../drafts/inline-comment-draft-store";
import { errorMessage } from "../lib/errors";
import type { ScheduleTask } from "../lib/scheduling";
import type { ClientFeedback } from "../platform/client-feedback";
import type { ClientStorage } from "../platform/client-storage";
import type { AttachmentStager } from "../platform/device-file";
import type { HostConnection } from "./host-connection";

export type ClientConnectionOptions = {
  host: HostConnection;
  /** A new query client for this connection only. */
  queryClient: QueryClient;
  /** Device storage for host-scoped drafts. A remote host gets memory storage. */
  storage: ClientStorage;
  /**
   * False when `storage` ends with the connection, such as the memory storage of a remote host.
   * Disposal then drops unsaved drafts, so it does not wait for their attachment uploads. The
   * default is true.
   */
  saveDraftsOnDispose?: boolean;
  feedback: ClientFeedback;
  stageAttachment: AttachmentStager;
  /** Releases the host transport, such as a remote admission. It must not stop host work. */
  releaseHost?: () => Promise<void>;
  /** Schedules debounced draft writes. The default uses timers. */
  scheduleTask?: ScheduleTask;
};

/** Drafts that belong to one host connection. Repository paths alone never identify a host. */
export type ClientDrafts = {
  readonly chat: AgentChatDraftStore;
  readonly inlineComments: InlineCommentDraftStoreApi;
  readonly queuedMessageEdits: QueuedMessageEditDrafts;
};

/**
 * The client state and lifetime of one host connection. React effects under
 * `ClientConnectionProvider` own the event subscriptions, so a platform unmounts that tree before
 * it disposes the connection.
 */
export type ClientConnection = {
  readonly host: HostConnection;
  readonly queryClient: QueryClient;
  /** Device storage for the state of this host, such as drafts and UI choices. */
  readonly storage: ClientStorage;
  readonly feedback: ClientFeedback;
  readonly stageAttachment: AttachmentStager;
  readonly drafts: ClientDrafts;
  /**
   * Writes every unsaved chat and inline comment draft now. It rejects with an actionable message
   * when a draft could not be saved. That draft stays in memory.
   */
  saveDrafts(): Promise<void>;
  /**
   * Saves drafts unless `saveDraftsOnDispose` is false, cancels reads, clears the cache, and
   * releases the host transport. It rejects when a step failed, including a draft save. It sends no
   * command that stops or changes host work, so host work that the host already admitted continues.
   */
  dispose(): Promise<void>;
};

// Each entry belongs to one connection. Query functions find their host through their own client.
const connectionsByQueryClient = new WeakMap<QueryClient, ClientConnection>();

/** Repeated saves of one long draft replace this one message. */
const CHAT_DRAFT_TOO_LARGE_FEEDBACK_ID = "chat-draft-too-large";

/**
 * The composer keeps a draft that is too long to save, so the user must know that closing the app
 * loses it. Other draft failures go to the console.
 */
const chatDraftPersistenceReporter =
  (feedback: ClientFeedback) =>
  (error: Error): void => {
    if (!(error instanceof ChatDraftTooLargeError)) {
      console.error(error);
      return;
    }
    const maxKilobytes = Math.floor(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES / 1024);
    feedback.show("warning", "This chat draft is too long to keep on this device", {
      id: CHAT_DRAFT_TOO_LARGE_FEEDBACK_ID,
      description: `The app does not save drafts over ${maxKilobytes} KB. Shorten the draft or send it before you close the app.`,
    });
  };

export const createClientConnection = ({
  host,
  queryClient,
  storage,
  saveDraftsOnDispose = true,
  feedback,
  stageAttachment,
  releaseHost,
  scheduleTask,
}: ClientConnectionOptions): ClientConnection => {
  if (connectionsByQueryClient.has(queryClient)) {
    throw new Error("This query client already belongs to another host connection.");
  }
  const drafts: ClientDrafts = {
    chat: createAgentChatDraftStore({
      storage,
      stageAttachment,
      reportPersistenceError: chatDraftPersistenceReporter(feedback),
      ...(scheduleTask && { scheduleTask }),
    }),
    inlineComments: createInlineCommentDraftStore({
      storage,
      ...(scheduleTask && { scheduleTask }),
    }),
    queuedMessageEdits: createQueuedMessageEditDrafts(),
  };
  const saveDrafts = async (): Promise<void> => {
    // Both saves start before the first await, so page hide keeps the drafts.
    const results = await Promise.allSettled([
      drafts.chat.saveAll(),
      (async () => drafts.inlineComments.saveAll())(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        failures.map((failure) => errorMessage(failure)).join(" "),
      );
    }
  };
  let disposal: Promise<void> | null = null;
  const connection: ClientConnection = {
    host,
    queryClient,
    storage,
    feedback,
    stageAttachment,
    drafts,
    saveDrafts,
    dispose: () => {
      disposal ??= (async () => {
        const failures: unknown[] = [];
        const attempt = async (step: () => void | Promise<void>) => {
          try {
            await step();
          } catch (cause) {
            failures.push(cause);
          }
        };
        // Page hide runs this. The draft writes start before the first await, so they end before unload.
        const draftsSaved = saveDraftsOnDispose ? attempt(saveDrafts) : Promise.resolve();
        drafts.queuedMessageEdits.dispose();
        await attempt(() => queryClient.cancelQueries());
        await draftsSaved;
        drafts.chat.dispose();
        drafts.inlineComments.dispose();
        queryClient.clear();
        connectionsByQueryClient.delete(queryClient);
        if (releaseHost) await attempt(releaseHost);
        if (failures.length > 0) {
          throw new AggregateError(failures, "The host connection did not release all its state.");
        }
      })();
      return disposal;
    },
  };
  connectionsByQueryClient.set(queryClient, connection);
  return connection;
};

/** The connection that owns `queryClient`. */
export const connectionOf = (queryClient: QueryClient): ClientConnection => {
  const connection = connectionsByQueryClient.get(queryClient);
  if (!connection) {
    throw new Error(
      "This query client has no open host connection. Create it with createClientConnection.",
    );
  }
  return connection;
};

/** The host client of the connection that owns `queryClient`. */
export const connectionHost = (queryClient: QueryClient): HostClient =>
  connectionOf(queryClient).host.client;
