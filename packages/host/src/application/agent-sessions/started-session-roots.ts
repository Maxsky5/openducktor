import type { AgentSessionAuthorizedRoot, AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import type { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";

/** Native creation binds a root before publication and durable ownership save. */
export const createStartedSessionRoots = () => {
  const entries = new Map<
    string,
    { binding: AgentSessionLiveRegistration; root: AgentSessionAuthorizedRoot }
  >();
  const read = (repoPath: string) =>
    [...entries.values()]
      .filter((entry) => entry.root.repoPath === repoPath)
      .map((entry) => entry.root);
  return {
    read,
    accept: (binding: AgentSessionLiveRegistration, root: AgentSessionAuthorizedRoot) => {
      entries.set(agentSessionRefKey(root), { binding, root });
    },
    merge: (saved: AgentSessionAuthorizedRoot[], repoPath: string) => {
      const keys = new Set(saved.map(agentSessionRefKey));
      return [...saved, ...read(repoPath).filter((root) => !keys.has(agentSessionRefKey(root)))];
    },
    releaseRuntime: (binding: AgentSessionLiveRegistration) => {
      for (const [key, entry] of entries) if (entry.binding === binding) entries.delete(key);
    },
    releaseSession: (ref: AgentSessionLiveRef) => entries.delete(agentSessionRefKey(ref)),
  };
};
