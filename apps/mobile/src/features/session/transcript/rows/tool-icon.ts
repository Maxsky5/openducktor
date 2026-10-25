import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { IconName } from "@/ui/icon";

/** The desktop `toolIcon`: the icon of a Tool Call from the tool type that the runtime reports. */
export const toolIcon = (meta: Pick<ToolMeta, "tool" | "toolType">): IconName => {
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
    default:
      return meta.tool.trim().toLowerCase() === "skill" ? "scroll-text" : "wrench";
  }
};
