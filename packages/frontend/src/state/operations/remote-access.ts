import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RemoteAccessBridge, RemoteAccessEnableInput } from "@openducktor/contracts";
import { remoteAccessQueryKey } from "@openducktor/frontend-core/queries/remote-access";

export function useRemoteAccessAction(bridge: RemoteAccessBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configuration: RemoteAccessEnableInput | null) =>
      configuration ? bridge.enable(configuration) : bridge.disable(),
    onMutate: () => queryClient.cancelQueries({ queryKey: remoteAccessQueryKey, exact: true }),
    onSuccess: (next) => queryClient.setQueryData(remoteAccessQueryKey, next),
  });
}
