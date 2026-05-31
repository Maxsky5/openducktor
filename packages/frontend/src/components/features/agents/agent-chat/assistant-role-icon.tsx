import type { AgentRole } from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { ReactElement } from "react";

export const assistantRoleIcon = (role: AgentRole): ReactElement => {
  if (role === "spec") {
    return <Sparkles className="size-3" />;
  }
  if (role === "planner") {
    return <Bot className="size-3" />;
  }
  if (role === "build") {
    return <Wrench className="size-3" />;
  }
  return <ShieldCheck className="size-3" />;
};
