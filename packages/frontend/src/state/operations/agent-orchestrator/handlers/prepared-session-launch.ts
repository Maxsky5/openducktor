import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentSessionScope,
  AgentSessionWorkflowScope,
} from "@openducktor/core";

type PreparedSessionLaunchBase = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  sessionAssociation: AgentSessionScope;
  holdForPostStartMessage?: boolean;
};

export type PreparedSessionLaunch =
  | (PreparedSessionLaunchBase & {
      mode: "start";
      sessionAssociation: AgentSessionWorkflowScope;
      systemPrompt: string;
      selectedModel: AgentModelSelection;
      targetWorkingDirectory?: string;
    })
  | (PreparedSessionLaunchBase & {
      mode: "start";
      sessionAssociation: Exclude<AgentSessionScope, AgentSessionWorkflowScope>;
      workingDirectory: string;
      systemPrompt: string;
      selectedModel?: AgentModelSelection;
    })
  | (PreparedSessionLaunchBase & {
      mode: "resume";
      workingDirectory: string;
      externalSessionId: string;
      systemPrompt?: string;
      selectedModel?: AgentModelSelection;
    })
  | (PreparedSessionLaunchBase & {
      mode: "fork";
      workingDirectory: string;
      systemPrompt: string;
      parentExternalSessionId: string;
      selectedModel?: AgentModelSelection;
    });
