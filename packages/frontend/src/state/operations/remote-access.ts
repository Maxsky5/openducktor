import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_REMOTE_PORT,
  remoteAccessEnableInputSchema,
  type RemoteAccessBridge,
  type RemoteAccessConfiguration,
  type RemoteAccessEnableInput,
  type RemoteAccessNetwork,
  type RemoteAccessState,
  remoteFailureText,
} from "@openducktor/contracts";
import {
  remoteAccessNetworksQueryOptions,
  remoteAccessQueryKey,
} from "@openducktor/frontend-core/queries/remote-access";
import { useRemoteAccess } from "@/state/remote-access-provider";

function useRemoteAccessAction(bridge: RemoteAccessBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configuration: RemoteAccessEnableInput | null) =>
      configuration ? bridge.enable(configuration) : bridge.disable(),
    onMutate: () => queryClient.cancelQueries({ queryKey: remoteAccessQueryKey, exact: true }),
    onSuccess: (next) => queryClient.setQueryData(remoteAccessQueryKey, next),
  });
}

/**
 * The listener choice, enable, and disable of the local host. Settings and Host connection share it,
 * so both start and stop Remote control the same way.
 */
export function useRemoteAccessSetup(bridge: RemoteAccessBridge) {
  const { state, error: stateError } = useRemoteAccess();
  const [draft, setDraft] = useState<RemoteAccessEnableInput | null>(null);
  const action = useRemoteAccessAction(bridge);
  const networks = useQuery(remoteAccessNetworksQueryOptions(bridge));
  const { status, configuration, failure } = state ?? {};
  const saved = draftFrom(configuration, networks.data ?? []);
  const fields = draft ?? saved;
  const parsed = remoteAccessEnableInputSchema.safeParse(fields);
  const failureMessage = failure ? remoteFailureText(failure) : undefined;
  const pending = action.isPending || status === "starting";
  const apply = (next: RemoteAccessEnableInput | null) =>
    action.mutate(next, {
      onSuccess: (result) => {
        if (result.status === "failed") return;
        setDraft(null);
        toast.success(
          result.status === "disabled" ? "Remote control is off" : "Remote control is on",
        );
      },
    });
  return {
    state,
    status,
    pending,
    /** The last failed action, read, or host failure. */
    message: action.error?.message ?? stateError ?? networks.error?.message ?? failureMessage,
    networks: networks.data ?? [],
    networksPending: networks.isPending,
    refreshingNetworks: networks.isFetching,
    refreshNetworks: () => {
      void networks.refetch();
    },
    fields,
    /** The parsed fields. The form shows their first issue. */
    parsed,
    /** True when the fields can start the listener without more input. */
    ready: parsed.success,
    changed: fieldsChanged(fields, saved),
    change: (value: Partial<RemoteAccessEnableInput>) => setDraft({ ...fields, ...value }),
    /** Drops unapplied field changes. */
    reset: () => setDraft(null),
    enable: (next: RemoteAccessEnableInput) => apply(next),
    disable: () => apply(null),
    /** A port that another app uses offers a free port, which the host then keeps. */
    anotherPort: offersAnotherPort(failure, fields)
      ? () => apply({ ...fields, listenPort: 0 })
      : null,
  };
}

export type RemoteAccessSetup = ReturnType<typeof useRemoteAccessSetup>;

/** Opens and closes the pairing window of the local host. */
export function useRemoteAccessPairing(bridge: RemoteAccessBridge) {
  const queryClient = useQueryClient();
  const onSuccess = (next: RemoteAccessState) =>
    queryClient.setQueryData(remoteAccessQueryKey, next);
  const start = useMutation({
    mutationFn: (renew: boolean) => bridge.startPairing({ renew }),
    onSuccess,
  });
  const stop = useMutation({ mutationFn: () => bridge.stopPairing(), onSuccess });
  // `mutate` keeps its identity across renders, so an effect can depend on it.
  const { mutate: startPairing } = start;
  return {
    start: useCallback(() => startPairing(false), [startPairing]),
    /** The next code of an expired window. The host keeps its count of wrong codes. */
    renew: useCallback(() => startPairing(true), [startPairing]),
    stop: () => stop.mutate(),
    starting: start.isPending,
    stopping: stop.isPending,
    error: start.error?.message ?? stop.error?.message,
    /** A failed start, which stops automatic renewal. A failed stop does not. */
    startFailed: start.isError,
  };
}

/** Removes the saved access of one paired client. */
export function useRevokeRemoteClient(bridge: RemoteAccessBridge) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => bridge.revokeClient(clientId),
    onSuccess: (next) => {
      queryClient.setQueryData(remoteAccessQueryKey, next);
      toast.success("Device removed", {
        description: "It needs a new pairing code to connect again.",
      });
    },
  });
}

/** A public host address needs its fixed port, so a busy port offers no other port then. */
const offersAnotherPort = (
  failure: RemoteAccessState["failure"],
  fields: RemoteAccessEnableInput,
): boolean => failure?.code === "port_in_use" && fields.publicEndpoint === undefined;

const fieldsChanged = (fields: RemoteAccessEnableInput, saved: RemoteAccessEnableInput): boolean =>
  fields.listenHost !== saved.listenHost ||
  fields.listenPort !== saved.listenPort ||
  fields.publicEndpoint !== saved.publicEndpoint ||
  JSON.stringify(fields.webOrigins) !== JSON.stringify(saved.webOrigins);

function draftFrom(
  configuration: RemoteAccessConfiguration | null | undefined,
  networks: RemoteAccessNetwork[],
): RemoteAccessEnableInput {
  if (!configuration)
    return {
      listenHost: networks.length === 1 ? networks[0]!.address : "",
      listenPort: DEFAULT_REMOTE_PORT,
    };
  const url = new URL(configuration.publicEndpoint);
  const host = configuration.listenHost;
  const hostname = new URL(
    `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`,
  ).hostname;
  const direct =
    url.protocol === "http:" &&
    url.pathname === "/" &&
    url.hostname === hostname &&
    Number(url.port || 80) === configuration.listenPort;
  const { publicEndpoint, ...fields } = configuration;
  return direct ? fields : { ...fields, publicEndpoint };
}
