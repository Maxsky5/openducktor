import type { ReactElement } from "react";
import { AgentTranscriptSeparator } from "./agent-transcript-separator";
import { formatTurnDurationLabel } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";

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
      label={formatTurnDurationLabel(durationMs)}
      {...(className ? { className } : {})}
    />
  );
}
