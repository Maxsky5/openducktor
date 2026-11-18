// A chip of the composer draft and of a sent user message. A slash command is a yellow chip without
// an icon, as agent-chat-composer-editor.tsx draws it. A file is sky blue with the icon of its type,
// as the file tree shows it, or the icon of its kind for a type without an icon
// (agent-chat-file-reference-chip-classnames.ts and agent-chat-file-reference-icon.tsx). A skill is
// purple with ScrollText (agent-chat-skill-reference-chip-markup.ts). The /goal command is a blue
// chip with Target and the label Goal (agent-chat-goal-chip-markup.ts), in the draft and in a sent
// message. Only files, skills, and the goal show as chips in a sent message:
// agent-chat-user-message-reference-chip.tsx and agent-chat-goal-chip.tsx.
import { FileCodeCorner, FileText, ScrollText, Target } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { FileTypeIcon, fileTypeOf } from "../ui/FileTypeIcon";
import "./ReferenceChip.css";

/** The label of the goal chip: AGENT_CHAT_GOAL_CHIP_LABEL. */
export const GOAL_CHIP_LABEL = "Goal";

/** The kind of a file, which sets its icon. */
export type FileKind = "code" | "default";

type ReferenceChipProps = ComponentProps<"span"> & { label: string } & (
    | { kind: "slash" | "skill" | "goal"; file?: never }
    | {
        kind: "file";
        /** The file of the chip: its path picks the icon of its type, and its kind the other icon. */
        file: { path: string; kind: FileKind };
      }
  );

/** The icon of a file: the icon of its type, or the icon of its kind. */
function FileIcon({ path, kind }: { path: string; kind: FileKind }): ReactElement {
  if (fileTypeOf(path)) return <FileTypeIcon path={path} />;
  return kind === "code" ? <FileCodeCorner /> : <FileText />;
}

export function ReferenceChip({
  kind,
  label,
  file,
  className,
  ...attributes
}: ReferenceChipProps): ReactElement {
  return (
    <span className={classes("ref-chip", className)} data-kind={kind} {...attributes}>
      {kind === "file" && <FileIcon {...file} />}
      {kind === "skill" && <ScrollText />}
      {kind === "goal" && <Target />}
      <span>{label}</span>
    </span>
  );
}
