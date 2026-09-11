import { FileText, Folder, Globe, ListTodo, Search, Terminal, Wrench } from "lucide-react";
import type { ReactElement } from "react";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

export const toolIcon = (meta: Pick<ToolMeta, "tool" | "toolType">): ReactElement => {
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
