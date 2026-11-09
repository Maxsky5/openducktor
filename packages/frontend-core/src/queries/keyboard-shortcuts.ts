import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
export const keyboardShortcutsQueryOptions = () =>
  queryOptions({
    queryKey: ["keyboard-shortcuts"],
    queryFn: ({ client }) => connectionHost(client).workspaceGetKeyboardShortcuts(),
    staleTime: Infinity,
  });
