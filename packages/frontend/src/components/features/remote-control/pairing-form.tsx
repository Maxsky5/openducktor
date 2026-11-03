import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { LoaderCircle, Server } from "lucide-react";
import { type RemoteFailure } from "@openducktor/contracts";
import {
  completesPairingCode,
  isPairingCode,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import {
  describeRemoteConnectionFailure,
  type RemoteConnectionFailure,
} from "@openducktor/frontend-core/lib/remote-connection-failure";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { Button } from "@/components/ui/button";
import type { ShellBridge } from "@/lib/shell-bridge";
import {
  ConnectedView,
  ConnectionFailureAlert,
  PairingCodeField,
  incompleteCodeFailure,
  waitForConnectedView,
} from "./connection-feedback";
import { RemoteNetworkNotice } from "./remote-network-notice";

type PairingFormProps = {
  endpoint: string;
  /** Why the connection stopped. A request for a code shows no alert. */
  failure: RemoteFailure | undefined;
  /** Pairs this client with the host and saves the access. */
  pair(pairingCode: string): Promise<void>;
  /** Connects with the saved access, then the host work opens. */
  reconnect(): Promise<void>;
  onCancel(): void;
};

const initialFailure = (failure: RemoteFailure | undefined): RemoteConnectionFailure | null => {
  if (!failure || failure.code === "authorization_required") return null;
  if (failure.code === "authorization_rejected")
    return {
      message: "This device needs a new pairing code.",
      nextAction: "Its saved access was removed or is not valid. On the host, select Add device.",
      // No code was wrong yet, so the code field does not show an error.
      pairing: false,
    };
  return { message: failure.message, nextAction: failure.nextAction, pairing: false };
};

/**
 * Pairs a client whose saved access the host refused. It uses the same code entry, alert, and
 * Connected view as the connect screen. Typing the sixth digit submits the code.
 */
export function PairingForm({
  endpoint,
  failure: connectionFailure,
  pair,
  reconnect,
  onCancel,
}: PairingFormProps): ReactElement {
  const id = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [failure, setFailure] = useState(() => initialFailure(connectionFailure));
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => input.current?.focus(), []);
  // The sixth digit and Enter can both submit before React renders the pending state.
  const flight = useSingleFlight();
  const submit = (pairingCode: string) =>
    flight.start(async () => {
      if (!isPairingCode(pairingCode)) {
        setFailure(incompleteCodeFailure);
        return;
      }
      setPending(true);
      try {
        await pair(pairingCode);
        if (cancelled.current) return;
        setFailure(null);
        setConnected(true);
        await waitForConnectedView();
        if (!cancelled.current) await reconnect();
      } catch (cause) {
        if (cancelled.current) return;
        setConnected(false);
        setFailure(describeRemoteConnectionFailure(cause));
      } finally {
        setPending(false);
      }
    });
  if (connected) return <ConnectedView endpoint={endpoint} />;
  const failureId = `${id}-failure`;
  return (
    <form
      className="grid gap-5"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5">
        <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-xs text-muted-foreground">Host</p>
          <p className="break-all font-mono text-sm text-foreground">{endpoint}</p>
        </div>
      </div>
      <PairingCodeField
        value={code}
        inputRef={input}
        busy={pending}
        invalid={failure?.pairing === true}
        errorId={failureId}
        help="On the host, open Remote control and select Add device."
        onChange={(value) => {
          setCode(value);
          if (failure?.pairing) setFailure(null);
          // A changed digit of a full code waits for Connect, so a correction can finish.
          if (completesPairingCode(code, value)) void submit(value);
        }}
      />
      {failure ? <ConnectionFailureAlert id={failureId} failure={failure} /> : null}
      <RemoteNetworkNotice endpoint={endpoint} />
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            cancelled.current = true;
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!isPairingCode(code)}>
          {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
          {pending ? "Connecting..." : "Connect"}
        </Button>
      </div>
    </form>
  );
}

/** The title and text above the re-pair form. */
export const PAIR_WITH_HOST = {
  title: "Pair with host",
  description: "Enter the code from the computer you want to use.",
} as const;

type ConnectionPairingFormProps = Pick<PairingFormProps, "endpoint" | "failure" | "pair"> & {
  connection: NonNullable<ShellBridge["remoteConnection"]>;
  /** Runs after the connection stops. */
  onCancel(): void;
};

/** The re-pair form of a live connection: it reconnects after pairing and disconnects on Cancel. */
export function ConnectionPairingForm({
  connection,
  endpoint,
  failure,
  pair,
  onCancel,
}: ConnectionPairingFormProps): ReactElement {
  return (
    <PairingForm
      endpoint={endpoint}
      failure={failure}
      pair={pair}
      reconnect={() => connection.connect()}
      onCancel={() => void connection.disconnect().then(onCancel)}
    />
  );
}
