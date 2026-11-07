import {
  FileText,
  Folder,
  GitPullRequest,
  Globe,
  ListTodo,
  ScrollText,
  Search,
  Terminal,
  Workflow,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { OdtToolIconKind } from "@openducktor/frontend-core/sessions/messages/odt-tool-call";

const SKILL_TOOL_NAMES = new Set(["skill", "Skill"]);

/** The icon of a Tool Call. The icon of an ODT tool card wins over the tool type. */
export const toolIcon = (
  meta: Pick<ToolMeta, "tool" | "toolType">,
  odtIcon: OdtToolIconKind | null = null,
): ReactElement => {
  if (odtIcon === "workflow") {
    return <Workflow className="size-3.5" />;
  }
  if (odtIcon === "git-pull-request") {
    return <GitPullRequest className="size-3.5" />;
  }
  if (SKILL_TOOL_NAMES.has(meta.tool)) {
    return <ScrollText className="size-3.5" />;
  }
  const value = meta.toolType;
  if (value === "read") {
    return <FileText className="size-3.5" />;
  }
  if (value === "bash") {
    return <Terminal className="size-3.5" />;
  }
  if (value === "list") {
    return <Folder className="size-3.5" />;
  }
  if (value === "search") {
    return <Search className="size-3.5" />;
  }
  if (value === "web") {
    return <Globe className="size-3.5" />;
  }
  if (value === "todo") {
    return <ListTodo className="size-3.5" />;
  }
  return <Wrench className="size-3.5" />;
};
