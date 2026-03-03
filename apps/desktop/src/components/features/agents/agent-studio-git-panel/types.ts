import type { DiffDataState } from "@/pages/agents/use-agent-studio-diff-data";

export type AgentStudioGitPanelModel = DiffDataState & {
  isCommitting?: boolean;
  isPushing?: boolean;
  isRebasing?: boolean;
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  commitAll?: (message: string) => Promise<void>;
  pushBranch?: () => Promise<void>;
  rebaseOntoTarget?: () => Promise<void>;
  pullFromUpstream?: () => Promise<void>;
  onSendReview?: (message: string) => void;
};
