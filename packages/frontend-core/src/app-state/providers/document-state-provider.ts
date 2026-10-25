import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { DocumentStateContext, useActiveWorkspaceContext } from "../app-state-contexts";
import { useDocumentOperations } from "../../tasks/operations/use-document-operations";

export function DocumentStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const documentState = useDocumentOperations({ activeWorkspace });

  return createElement(DocumentStateContext.Provider, { value: documentState }, children);
}
