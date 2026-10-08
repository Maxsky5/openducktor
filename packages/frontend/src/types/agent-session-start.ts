import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "./agent-orchestrator";

export type StartAgentSessionInput =
  | {
      taskId: string;
      role: AgentRole;
      selectedModel?: never;
      startMode: "reuse";
      sourceSession: AgentSessionIdentity;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fresh";
      holdForPostStartMessage?: boolean;
      /** Only the request that runs the launch can claim the held session. */
      claimStart?: (session: AgentSessionState) => void;
      queueIfBusy?: boolean;
      targetWorkingDirectory?: string | null;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fork";
      sourceSession: AgentSessionIdentity;
      holdForPostStartMessage?: boolean;
      claimStart?: (session: AgentSessionState) => void;
    };

export type StartAgentSessionResult = AgentSessionIdentity;

export type StartAgentSession = (input: StartAgentSessionInput) => Promise<StartAgentSessionResult>;
