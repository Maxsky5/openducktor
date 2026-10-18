import {
  createAgentSessionsStore,
  type AgentSessionsStore,
} from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentOrchestratorState } from "@openducktor/frontend-core/sessions/agent-orchestrator/use-agent-orchestrator-operations";

/** Views read one workspace; shared listeners also keep hidden transcripts warm. */
export const createWorkspaceAgentSessions = (): WorkspaceAgentSessions => {
  const controllers = new Map<string, { controller: AgentOrchestratorState; stop: () => void }>();
  const listeners = new Set<() => void>();
  const empty = createAgentSessionsStore();
  const notify = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  const getStore = (repoPath: string): AgentSessionsStore | null =>
    controllers.get(repoPath)?.controller.sessionStore ?? null;
  const listSessionTaskIds = (repoPath: string) =>
    getStore(repoPath)?.listSessionTaskIds(repoPath) ?? [];
  const removeTaskSessions = (repoPath: string, taskIds: string[]) =>
    getStore(repoPath)?.removeTaskSessions(repoPath, taskIds);
  const subscribe: AgentSessionsStore["subscribe"] = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const createView = (repoPath: string | null): AgentSessionsStore => {
    const selectedStore = () => getStore(repoPath ?? "") ?? empty;
    const requireStore = () => {
      const store = getStore(repoPath ?? "");
      if (!store)
        throw new Error(
          `Session state for workspace '${repoPath}' is unavailable. Reopen the workspace before changing a session.`,
        );
      return store;
    };
    return {
      subscribe,
      getWorkspaceStore: getStore,
      getSessionSource: (identity) => {
        const selected = selectedStore().getSessionSource(identity);
        if (selected) return selected;
        for (const { controller } of controllers.values()) {
          const source = controller.sessionStore.getSessionSource(identity);
          if (source) return source;
        }
        return null;
      },
      getActivitySnapshot: () => selectedStore().getActivitySnapshot(),
      listSessionSnapshots: () => selectedStore().listSessionSnapshots(),
      getSessionSnapshot: (identity) => selectedStore().getSessionSnapshot(identity),
      getVisiblePendingInputSnapshot: (identity) =>
        selectedStore().getVisiblePendingInputSnapshot(identity),
      commitSessionCollection: (commit) => requireStore().commitSessionCollection(commit),
      setSessionCollection: (updater) => requireStore().setSessionCollection(updater),
      replaceSession: (session) => requireStore().replaceSession(session),
      removeSession: (identity) => requireStore().removeSession(identity),
      updateSession: (identity, updater) => requireStore().updateSession(identity, updater),
      applyLiveSessionEnvelope: (envelope) => requireStore().applyLiveSessionEnvelope(envelope),
      recordHistoryEnvelope: (envelope) => requireStore().recordHistoryEnvelope(envelope),
      listSessionTaskIds,
      removeTaskSessions,
    };
  };
  return {
    subscribe,
    createView,
    getController: (repoPath: string | null) => controllers.get(repoPath ?? "")?.controller ?? null,
    publish: (repoPath: string, controller: AgentOrchestratorState) => {
      const current = controllers.get(repoPath);
      if (current?.controller === controller) return;
      controllers.set(repoPath, {
        controller,
        stop: current?.stop ?? controller.sessionStore.subscribe(notify),
      });
      notify();
    },
    release: (repoPath: string) => {
      controllers.get(repoPath)?.stop();
      controllers.delete(repoPath);
      notify();
    },
  };
};

export type WorkspaceAgentSessions = {
  subscribe: AgentSessionsStore["subscribe"];
  createView: (repoPath: string | null) => AgentSessionsStore;
  getController: (repoPath: string | null) => AgentOrchestratorState | null;
  publish: (repoPath: string, controller: AgentOrchestratorState) => void;
  release: (repoPath: string) => void;
};
