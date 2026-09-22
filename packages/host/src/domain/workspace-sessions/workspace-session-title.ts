import {
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  type AcceptedAgentUserMessage,
  type WorkspaceSession,
} from "@openducktor/contracts";

export const runtimeTitleFor = (
  session: Pick<WorkspaceSession, "generatedTitle" | "manualTitle">,
  manualTitle: string | null = session.manualTitle,
): string | null => {
  const title = manualTitle?.trim() || session.generatedTitle;
  return title ? title : null;
};

export const buildWorkspaceSessionTitle = (message: AcceptedAgentUserMessage): string | null => {
  const text = message.parts
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.synthetic ? "" : part.text;
        case "file_reference":
          return part.file.name;
        case "skill_mention":
          return part.skill.name;
        case "subagent_reference":
          return part.subagent.name;
        case "attachment":
          return part.attachment.name;
      }
    })
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length <= WORKSPACE_SESSION_GENERATED_TITLE_LIMIT) return text;
  let prefix = "";
  for (const character of text) {
    if (prefix.length + character.length >= WORKSPACE_SESSION_GENERATED_TITLE_LIMIT) break;
    prefix += character;
  }
  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace > 0 && text[prefix.length] !== " ") prefix = prefix.slice(0, lastSpace);
  return `${prefix.trimEnd()}…`;
};
