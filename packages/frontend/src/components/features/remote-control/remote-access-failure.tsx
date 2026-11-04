import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { RemoteAccessSetup } from "@/state/operations/remote-access";

/** A sharing failure or read error, with Use another port when another app uses the port. */
export function RemoteAccessFailure({ setup }: { setup: RemoteAccessSetup }) {
  return (
    <Alert variant="destructive" className="flex-wrap items-center justify-between">
      <p className="min-w-0">{setup.message}</p>
      {setup.anotherPort ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={setup.pending}
          onClick={setup.anotherPort}
        >
          Use another port
        </Button>
      ) : null}
    </Alert>
  );
}
