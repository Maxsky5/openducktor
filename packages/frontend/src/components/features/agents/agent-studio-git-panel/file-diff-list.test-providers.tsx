import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import type { PropsWithChildren, ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fileDiffListConnection } from "./file-diff-list.test-support";

/** Gives a file diff list the connection of the current test and the tooltip provider. */
export function FileDiffListProviders({ children }: PropsWithChildren): ReactElement {
  return (
    <ClientConnectionProvider connection={fileDiffListConnection()}>
      <TooltipProvider>{children}</TooltipProvider>
    </ClientConnectionProvider>
  );
}
