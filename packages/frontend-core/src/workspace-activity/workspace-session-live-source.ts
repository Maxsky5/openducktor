import type {
  AgentSessionLiveAttachInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshotEnvelope,
} from "@openducktor/contracts";
import { createAgentSessionLiveAttachment } from "@openducktor/host-client";
import { createContext } from "react";
import { errorMessage } from "../lib/errors";

type Listener = (envelope: AgentSessionLiveEnvelope) => void;
type Observe = (input: AgentSessionLiveAttachInput, listener: Listener) => Promise<() => void>;
type WorkspaceSessionLiveSource = {
  observeWorkspace: (input: AgentSessionLiveAttachInput, listener: Listener) => () => void;
  observeAgentSessionLive: Observe;
};
type Connection = {
  listeners: Set<Listener>;
  activityListener: Listener | null;
  ready: ReturnType<typeof Promise.withResolvers<void>>;
  stop: (() => void) | null;
  failure: Error | null;
  closed: boolean;
  hadController: boolean;
};

/** The activity observer owns the transport. Controllers use that same ordered stream. */
export const createWorkspaceSessionLiveSource = (
  observe: Observe,
  attach: (input: AgentSessionLiveAttachInput) => Promise<AgentSessionLiveSnapshotEnvelope>,
): WorkspaceSessionLiveSource => {
  const connections = new Map<string, Connection>();
  const observeWorkspace = (
    input: AgentSessionLiveAttachInput,
    listener: Listener,
  ): (() => void) => {
    const connection = getConnection(input.repoPath);
    connection.activityListener = listener;
    start(input, connection);
    return () => {
      connection.closed = true;
      connection.ready.resolve();
      connection.stop?.();
      connection.listeners.clear();
      if (connections.get(input.repoPath) === connection) connections.delete(input.repoPath);
    };
  };
  const observeAgentSessionLive: Observe = async (input, listener) => {
    const connection = getConnection(input.repoPath);
    let stopped = false;
    let hasStreamSnapshot = false;
    const attachment = createAgentSessionLiveAttachment(input.repoPath, (envelope) => {
      if (!stopped && !connection.closed) listener(envelope);
    });
    const receive = (envelope: AgentSessionLiveEnvelope) => {
      if (
        envelope.type === "snapshot" &&
        envelope.isConnectionSnapshot &&
        envelope.repoPath === input.repoPath
      ) {
        hasStreamSnapshot = true;
        if (envelope.historyReplayGap) attachment.restart();
        attachment.install(envelope);
      } else {
        attachment.accept(envelope);
      }
    };
    connection.listeners.add(receive);
    // A later controller attachment comes from an explicit read-model retry.
    if (connection.hadController && connection.failure && connection.activityListener) {
      connection.failure = null;
      connection.ready = Promise.withResolvers<void>();
      start(input, connection);
    }
    connection.hadController = true;
    try {
      await connection.ready.promise;
      if (connection.failure) throw connection.failure;
      if (connection.closed)
        throw new Error(`Workspace '${input.repoPath}' closed during session attachment.`);
      if (!hasStreamSnapshot) {
        try {
          const snapshot = await attach(input);
          if (!connection.closed && !hasStreamSnapshot) attachment.install(snapshot);
        } catch (cause) {
          // A stream snapshot can replace this read before it fails.
          if (!hasStreamSnapshot) throw cause;
        }
      }
      return () => {
        stopped = true;
        connection.listeners.delete(receive);
      };
    } catch (cause) {
      connection.listeners.delete(receive);
      throw cause;
    }
  };
  const getConnection = (repoPath: string) => {
    let connection = connections.get(repoPath);
    if (!connection) {
      connection = {
        listeners: new Set(),
        activityListener: null,
        ready: Promise.withResolvers<void>(),
        stop: null,
        failure: null,
        closed: false,
        hadController: false,
      };
      connections.set(repoPath, connection);
    }
    return connection;
  };
  const start = (input: AgentSessionLiveAttachInput, connection: Connection) => {
    const deliver = (envelope: AgentSessionLiveEnvelope) => {
      if (connection.closed) return;
      connection.activityListener?.(envelope);
      for (const consume of Array.from(connection.listeners)) consume(envelope);
    };
    void observe(input, deliver).then(
      (stop) => {
        if (connection.closed) stop();
        else connection.stop = stop;
        connection.ready.resolve();
      },
      (cause: unknown) => {
        connection.failure = new Error(errorMessage(cause), { cause });
        deliver({ type: "fault", repoPath: input.repoPath, message: errorMessage(cause) });
        connection.ready.resolve();
      },
    );
  };
  return { observeWorkspace, observeAgentSessionLive };
};

export const WorkspaceSessionLiveSourceContext = createContext<WorkspaceSessionLiveSource | null>(
  null,
);
