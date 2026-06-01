import type { AgentRole } from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { ReactElement } from "react";

export const assistantRoleIcon = (role: AgentRole): ReactElement => {
  switch (role) {
    case "spec":
      return <Sparkles className="size-3" />;
    case "planner":
      return <Bot className="size-3" />;
    case "build":
      return <Wrench className="size-3" />;
    default:
      return <ShieldCheck className="size-3" />;
  }
};
