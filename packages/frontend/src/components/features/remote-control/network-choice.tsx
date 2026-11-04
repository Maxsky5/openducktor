import { useId } from "react";
import { RefreshCw } from "lucide-react";
import type { RemoteAccessNetwork } from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type NetworkChoiceProps = {
  networks: RemoteAccessNetwork[];
  value: string;
  onChange(listenHost: string): void;
  onRefresh(): void;
  refreshing: boolean;
  disabled: boolean;
  invalid?: boolean;
  /** The ID of an error message that describes the choice. */
  errorId?: string;
};

/** The network addresses of this computer that another device can reach. */
export function NetworkChoice({
  networks,
  value,
  onChange,
  onRefresh,
  refreshing,
  disabled,
  invalid = false,
  errorId,
}: NetworkChoiceProps) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <Label id={`${id}-label`}>Network</Label>
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            Choose the network that your other device uses.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-mr-2 text-muted-foreground"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>
      {networks.length ? (
        <RadioGroup
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help${invalid && errorId ? ` ${errorId}` : ""}`}
          aria-invalid={invalid}
          className="gap-0 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          {networks.map((network, index) => (
            <Label
              key={network.address}
              htmlFor={`${id}-${index}`}
              className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 font-normal hover:bg-muted/50 has-[[data-state=checked]]:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            >
              <RadioGroupItem id={`${id}-${index}`} value={network.address} />
              <span className="min-w-0 flex-1 break-all font-mono text-sm">{network.address}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{network.name}</span>
            </Label>
          ))}
        </RadioGroup>
      ) : (
        <p className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
          No network found. Connect this computer to a network, then refresh.
        </p>
      )}
    </div>
  );
}
