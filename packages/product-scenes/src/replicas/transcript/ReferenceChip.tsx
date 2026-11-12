// A chip of the composer draft and of a sent user message. A slash command is a yellow chip without
// an icon, as agent-chat-composer-editor.tsx draws it. A file is sky blue with the icon of its kind
// (agent-chat-file-reference-chip-classnames.ts and agent-chat-file-reference-icon.tsx). A skill is
// purple with ScrollText (agent-chat-skill-reference-chip-markup.ts). The /goal command is a blue
// chip with Target and the label Goal (agent-chat-goal-chip-markup.ts), in the draft and in a sent
// message. Only files, skills, and the goal show as chips in a sent message:
// agent-chat-user-message-reference-chip.tsx and agent-chat-goal-chip.tsx.
import { FileCodeCorner, FileText, ScrollText, Target } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./ReferenceChip.css";

/** The label of the goal chip: AGENT_CHAT_GOAL_CHIP_LABEL. */
export const GOAL_CHIP_LABEL = "Goal";

/** The kind of a file, which sets its icon. */
export type FileKind = "code" | "default";

type ReferenceChipProps = ComponentProps<"span"> & {
  kind: "slash" | "file" | "skill" | "goal";
  label: string;
  fileKind?: FileKind;
};

export function ReferenceChip({
  kind,
  label,
  fileKind = "default",
  className,
  ...attributes
}: ReferenceChipProps): ReactElement {
  const FileIcon = fileKind === "code" ? FileCodeCorner : FileText;
  return (
    <span className={classes("ref-chip", className)} data-kind={kind} {...attributes}>
      {kind === "file" && <FileIcon />}
      {kind === "skill" && <ScrollText />}
      {kind === "goal" && <Target />}
      <span>{label}</span>
    </span>
  );
}
