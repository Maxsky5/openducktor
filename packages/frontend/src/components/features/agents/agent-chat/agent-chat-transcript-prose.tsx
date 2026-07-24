import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

const TRANSCRIPT_PROSE_CLASS_NAME = "whitespace-pre-wrap break-words line-clamp-2";

const transcriptProseClassName = (className?: string): string =>
  cn(TRANSCRIPT_PROSE_CLASS_NAME, className);

type AgentChatTranscriptProseProps = {
  children: ReactNode;
  className?: string;
};

export const AgentChatTranscriptProse = ({
  children,
  className,
}: AgentChatTranscriptProseProps): ReactElement => (
  <p className={transcriptProseClassName(className)}>{children}</p>
);
