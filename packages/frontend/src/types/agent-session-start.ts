import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { AgentSessionIdentity } from "./agent-orchestrator";

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
      targetWorkingDirectory?: string | null;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fork";
      sourceSession: AgentSessionIdentity;
      holdForPostStartMessage?: boolean;
    };

export type StartAgentSessionResult = AgentSessionIdentity;

export type StartAgentSession = (input: StartAgentSessionInput) => Promise<StartAgentSessionResult>;
