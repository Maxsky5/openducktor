import type { ReactElement } from "react";
import { AgentTranscriptSeparator } from "./agent-transcript-separator";
import { formatAgentDuration } from "./format-agent-duration";

type AgentTurnDurationSeparatorProps = {
  durationMs: number;
  className?: string;
};

export function AgentTurnDurationSeparator({
  durationMs,
  className,
}: AgentTurnDurationSeparatorProps): ReactElement {
  return (
    <AgentTranscriptSeparator
      label={`Worked for ${formatAgentDuration(durationMs)}`}
      {...(className ? { className } : {})}
    />
  );
}
