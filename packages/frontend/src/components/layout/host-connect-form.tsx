import { useId, useState } from "react";
import {
  completesPairingCode,
  isPairingCode,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import {
  describeRemoteConnectionFailure,
  type RemoteConnectionFailure,
} from "@openducktor/frontend-core/lib/remote-connection-failure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ConnectionFailureAlert,
  PairingCodeField,
  incompleteCodeFailure,
  waitForConnectedView,
} from "@/components/features/remote-control/connection-feedback";
import type { HostSelection } from "@/lib/host-location";

export type HostAction = "connect" | "local" | "disconnect";
/** The connect field that a failure belongs to. */
type Field = "address" | "code";

/** A failure of a host action, with the field that caused it. */
type HostActionFailure = RemoteConnectionFailure & { field: Field | null };

const actionFailure = (action: HostAction, cause: unknown): HostActionFailure => {
  const failure = describeRemoteConnectionFailure(cause);
  let field: Field | null = null;
  if (action === "connect") field = failure.pairing ? "code" : "address";
  return { ...failure, field };
};

/**
 * The host address and pairing code form, and the host actions that share its pending state. The
 * form checks the host first, shows a short success view, and then opens the host. A failure
 * replaces the previous one only when the new result arrives, so the form never flickers.
 */
export function useHostConnectForm(selection: HostSelection, initialError: string | undefined) {
  const [endpoint, setEndpoint] = useState("");
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<HostActionFailure | null>(
    initialError
      ? {
          field: "address",
          message: initialError,
          nextAction: null,
          pairing: false,
        }
      : null,
  );
  const [pending, setPending] = useState<HostAction | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  // The sixth digit and Enter can both submit before React renders the pending state.
  const flight = useSingleFlight();
  const run = (action: HostAction, work: () => Promise<void>): Promise<void> =>
    flight.start(async () => {
      setPending(action);
      try {
        await work();
      } catch (cause) {
        setConnected(null);
        setFailure(actionFailure(action, cause));
      } finally {
        setPending(null);
      }
    });
  const connectTo = async (pairingCode: string) => {
    if (pairingCode && !isPairingCode(pairingCode)) {
      setFailure({
        ...incompleteCodeFailure,
        nextAction: "Leave the code empty if this device is already paired with the host.",
        field: "code",
      });
      return;
    }
    const address = await selection.confirm(endpoint, pairingCode || undefined);
    setFailure(null);
    setConnected(address);
    await waitForConnectedView();
    await selection.select(address);
  };
  return {
    endpoint,
    code,
    pending,
    failure,
    connected,
    run,
    submit: (event: { preventDefault(): void }) => {
      event.preventDefault();
      void run("connect", () => connectTo(code));
    },
    changeAddress: (value: string) => {
      setEndpoint(value);
      if (failure?.field === "address") setFailure(null);
    },
    changeCode: (value: string) => {
      setCode(value);
      if (failure?.field === "code") setFailure(null);
      // Typing the sixth digit connects when the address is there.
      if (completesPairingCode(code, value) && endpoint.trim())
        void run("connect", () => connectTo(value));
    },
  };
}

export function HostConnectFields({
  currentHost,
  address,
  code,
  busy,
  onAddressChange,
  onCodeChange,
  failure,
}: {
  currentHost: boolean;
  address: string;
  code: string;
  busy: boolean;
  onAddressChange(value: string): void;
  onCodeChange(value: string): void;
  failure: HostActionFailure | null;
}) {
  const id = useId();
  const failureId = `${id}-failure`;
  const failedField = failure?.field ?? null;
  return (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">
        On the other computer, open Remote control and select Add device. It shows the address and
        the code.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-address`}>Host address</Label>
        <Input
          id={`${id}-address`}
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="http://192.168.1.9:14328"
          value={address}
          readOnly={busy}
          aria-invalid={failedField === "address"}
          aria-describedby={failedField === "address" ? failureId : undefined}
          onChange={(event) => onAddressChange(event.target.value)}
        />
      </div>
      <PairingCodeField
        value={code}
        onChange={onCodeChange}
        busy={busy}
        invalid={failedField === "code"}
        errorId={failureId}
        help="Leave it empty if this device is already paired with the host."
      />
      {failure ? <ConnectionFailureAlert id={failureId} failure={failure} /> : null}
      {currentHost ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Opening another host reloads this window. Save unsent drafts first.
        </p>
      ) : null}
    </>
  );
}
