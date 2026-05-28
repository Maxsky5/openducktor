import type { ReactElement } from "react";
import { AgentsPageLayout } from "./agents-page-layout";
import { useAgentsPageShellModel } from "./use-agents-page-shell-model";

export function AgentsPage(): ReactElement {
  const shell = useAgentsPageShellModel();

  return <AgentsPageLayout model={shell} />;
}
