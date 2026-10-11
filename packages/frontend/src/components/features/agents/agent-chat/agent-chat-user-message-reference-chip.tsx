import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { AgentChatFileReferenceChip } from "./agent-chat-file-reference-chip";
import { AgentChatSkillReferenceChip } from "./agent-chat-skill-reference-chip";
import { AgentChatSubagentReferenceChip } from "./agent-chat-subagent-reference-chip";

const USER_MESSAGE_REFERENCE_KINDS = [
  "file_reference",
  "skill_mention",
  "subagent_reference",
] as const;

export type UserMessageReferenceKind = (typeof USER_MESSAGE_REFERENCE_KINDS)[number];

const referenceKinds: ReadonlySet<string> = new Set(USER_MESSAGE_REFERENCE_KINDS);

/** A file, skill, or subagent reference in a user message. */
export type UserMessageReferencePart = Extract<
  AgentSessionUserMessagePart,
  { kind: UserMessageReferenceKind }
>;

/** Tells if a part of a user message shows as a reference chip. */
export const isUserMessageReferencePart = <Part extends { kind: string }>(
  part: Part,
): part is Extract<Part, { kind: UserMessageReferenceKind }> => referenceKinds.has(part.kind);

/** The transcript size, or a smaller one that fits a single line of the message queue. */
export type UserMessageReferenceChipSize = "default" | "compact";

const referenceChipClassName = (size: UserMessageReferenceChipSize): string =>
  cn("mx-1 max-w-full align-middle", size === "compact" && "h-5 gap-1 px-2 text-[11px]");

/** Shows a reference of a user message, in the transcript and in the message queue. */
export function renderUserMessageReferenceChip(
  part: UserMessageReferencePart,
  key: string,
  size: UserMessageReferenceChipSize = "default",
): ReactElement {
  const className = referenceChipClassName(size);
  if (part.kind === "skill_mention") {
    return <AgentChatSkillReferenceChip key={key} skill={part.skill} className={className} />;
  }
  if (part.kind === "subagent_reference") {
    return (
      <AgentChatSubagentReferenceChip key={key} subagent={part.subagent} className={className} />
    );
  }
  return <AgentChatFileReferenceChip key={key} file={part.file} className={className} tooltip />;
}
