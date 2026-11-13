import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { OdtToolIconKind } from "@openducktor/frontend-core/sessions/messages/odt-tool-call";
import type { IconName } from "@/ui/icon";

const ODT_TOOL_ICONS = {
  workflow: "workflow",
  "git-pull-request": "git-pull-request",
} as const satisfies Record<OdtToolIconKind, IconName>;

/**
 * The desktop `toolIcon`: the icon of a Tool Call from the tool type that the runtime reports.
 * The icon of an ODT tool card wins over the tool type.
 */
export const toolIcon = (
  meta: Pick<ToolMeta, "tool" | "toolType">,
  odtIcon: OdtToolIconKind | null = null,
): IconName => {
  if (odtIcon) return ODT_TOOL_ICONS[odtIcon];
  switch (meta.toolType) {
    case "read":
      return "file-text";
    case "bash":
      return "terminal";
    case "list":
      return "folder";
    case "search":
      return "search";
    case "web":
      return "globe";
    case "todo":
      return "list-todo";
    case "file_edit":
      return "pencil-line";
    default:
      return meta.tool.trim().toLowerCase() === "skill" ? "scroll-text" : "wrench";
  }
};
