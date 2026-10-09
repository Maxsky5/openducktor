import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { AgentSessionIdentity } from "./agent-orchestrator";

export type StartAgentSessionInput =
  | {
      taskId: string;
      role: AgentRole;
      selectedModel?: never;
      startMode: "reuse";
      speed?: string | null | undefined;
      sourceSession: AgentSessionIdentity;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fresh";
      speed?: string | null | undefined;
      queueIfBusy?: boolean;
      targetWorkingDirectory?: string | null;
    }
  | {
      taskId: string;
      role: AgentRole;
      selectedModel: AgentModelSelection;
      startMode: "fork";
      speed?: string | null | undefined;
      sourceSession: AgentSessionIdentity;
    };

export type StartAgentSessionResult = AgentSessionIdentity;

export type StartAgentSession = (input: StartAgentSessionInput) => Promise<StartAgentSessionResult>;
