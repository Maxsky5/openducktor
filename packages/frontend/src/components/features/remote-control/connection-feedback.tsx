import { useId, type RefObject } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import type { RemoteConnectionFailure } from "@openducktor/frontend-core/lib/remote-connection-failure";
import { PairingCodeInput } from "./pairing-code-input";

/** How long the Connected view stays before the host opens. */
export const CONNECTED_VIEW_MS = 1000;

/** Waits while the Connected view shows. */
export const waitForConnectedView = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, CONNECTED_VIEW_MS));

/** The failure that a code field shows before any submit. */
export const incompleteCodeFailure: RemoteConnectionFailure = {
  message: "Enter all six digits of the pairing code.",
  nextAction: null,
  pairing: true,
};

export function ConnectionFailureAlert({
  id,
  failure,
}: {
  id: string;
  failure: Pick<RemoteConnectionFailure, "message" | "nextAction">;
}) {
  return (
    <Alert id={id} variant="destructive">
      <CircleAlert aria-hidden="true" />
      <div className="grid gap-0.5">
        <AlertTitle>{failure.message}</AlertTitle>
        {failure.nextAction ? (
          <AlertDescription className="text-xs opacity-90">{failure.nextAction}</AlertDescription>
        ) : null}
      </div>
    </Alert>
  );
}

/** The six-digit code field with its label and help. */
export function PairingCodeField({
  value,
  onChange,
  busy,
  invalid,
  errorId,
  help,
  inputRef,
}: {
  value: string;
  onChange(value: string): void;
  busy: boolean;
  invalid: boolean;
  /** The ID of the alert that explains a failure of this field. */
  errorId: string;
  help: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Pairing code</Label>
      <PairingCodeInput
        id={id}
        value={value}
        readOnly={busy}
        onChange={onChange}
        aria-invalid={invalid}
        aria-describedby={`${id}-help${invalid ? ` ${errorId}` : ""}`}
        {...(inputRef && { ref: inputRef })}
      />
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
        {help}
      </p>
    </div>
  );
}

/** Confirms the connection for a moment before the host opens. */
export function ConnectedView({ endpoint }: { endpoint: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-4 py-8 text-center transition-[opacity,scale] duration-200 ease-(--motion-ease-out) starting:scale-95 starting:opacity-0 motion-reduce:transition-none"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-success-surface text-success-icon">
        <CircleCheck className="size-7" aria-hidden="true" />
      </span>
      <div className="grid gap-1">
        <p className="text-base font-semibold text-foreground">Connected</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{endpoint}</p>
      </div>
      <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        Opening the host...
      </p>
    </div>
  );
}
