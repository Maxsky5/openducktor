import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionScope } from "@openducktor/core";

type PreparedSessionLaunchBase = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  sessionAssociation: AgentSessionScope;
  holdForPostStartMessage?: boolean;
};

export type PreparedSessionLaunch = PreparedSessionLaunchBase &
  (
    | {
        mode: "start";
        systemPrompt: string;
        selectedModel: AgentModelSelection;
      }
    | {
        mode: "resume";
        externalSessionId: string;
        systemPrompt?: string;
        selectedModel?: AgentModelSelection;
      }
    | {
        mode: "fork";
        systemPrompt: string;
        parentExternalSessionId: string;
        selectedModel?: AgentModelSelection;
      }
  );
