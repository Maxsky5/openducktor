import type {
  AgentRuntimes,
  RuntimeDescriptor,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { CircleAlert, CircleCheck, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactElement, useState } from "react";
import { FolderPickerDialog } from "@/components/features/repository/folder-picker-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { runtimeExecutableResultForPath } from "./runtime-executable-validation";

type RuntimeExecutablePanelProps = {
  runtimes: AgentRuntimes;
  definitions: RuntimeDescriptor[];
  results: RuntimeExecutableCheckResult[];
  disabled?: boolean;
  isChecking?: boolean;
  onChange: (next: AgentRuntimes) => void;
  onCheckAgain: () => void;
};

const RUNTIME_MONOGRAMS: Record<RuntimeKind, string> = {
  opencode: "OC",
  codex: "CX",
  claude: "CL",
};

type RuntimeStatusProps = {
  result: RuntimeExecutableCheckResult | undefined;
  isChecking: boolean;
  showInvalidState: boolean;
  enabled: boolean;
};

function RuntimeStatusBadge({
  result,
  isChecking,
  showInvalidState,
  enabled,
}: RuntimeStatusProps): ReactElement {
  if (isChecking) return <Badge variant="outline">Checking</Badge>;
  if (result?.ok === true) return <Badge variant="success">Available</Badge>;
  if (showInvalidState && enabled) return <Badge variant="danger">Needs attention</Badge>;
  return <Badge variant="outline">Not found</Badge>;
}

function RuntimeStatusMessage({
  result,
  isChecking,
  showInvalidState,
  enabled,
}: RuntimeStatusProps): ReactElement {
  if (isChecking) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        Validating saved executable path...
      </span>
    );
  }
  if (result?.ok === true) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck className="size-3.5 text-success-muted" aria-hidden="true" />
        {result.version ?? "Executable is ready"} at {result.path}
      </span>
    );
  }
  if (showInvalidState && result?.ok === false) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CircleAlert
          className={cn("size-3.5", enabled ? "text-destructive" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {result.error}
      </span>
    );
  }
  return <span>Enter or choose an executable path.</span>;
}

export function RuntimeExecutablePanel({
  runtimes,
  definitions,
  results,
  disabled = false,
  isChecking = false,
  onChange,
  onCheckAgain,
}: RuntimeExecutablePanelProps): ReactElement {
  const [pickerRuntimeKind, setPickerRuntimeKind] = useState<RuntimeKind | null>(null);

  const updateRuntime = (kind: RuntimeKind, update: Partial<AgentRuntimes[RuntimeKind]>): void => {
    onChange({
      ...runtimes,
      [kind]: { ...runtimes[kind], ...update },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          OpenDucktor uses these exact paths for checks and agent sessions.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isChecking}
          onClick={onCheckAgain}
        >
          <RefreshCw data-icon="inline-start" />
          {isChecking ? "Checking..." : "Check again"}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {definitions.map((definition) => {
          const kind = definition.kind;
          const config = runtimes[kind];
          const result = runtimeExecutableResultForPath(kind, config.executablePath, results);
          const hasInvalidResult = result?.ok === false;
          const showInvalidState = !isChecking && hasInvalidResult;
          const inputInvalid = config.enabled && showInvalidState;
          const inputId = `runtime-executable-${kind}`;
          return (
            <section
              key={kind}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors duration-150 motion-reduce:transition-none",
                inputInvalid ? "border-destructive-border" : "border-border",
              )}
              aria-labelledby={`${inputId}-title`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold uppercase text-foreground">
                    {RUNTIME_MONOGRAMS[kind]}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 id={`${inputId}-title`} className="truncate font-semibold text-foreground">
                      {definition.label}
                    </h3>
                    <RuntimeStatusBadge
                      result={result}
                      isChecking={isChecking}
                      showInvalidState={showInvalidState}
                      enabled={config.enabled}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${inputId}-enabled`}>Enabled</Label>
                  <Switch
                    id={`${inputId}-enabled`}
                    checked={config.enabled}
                    disabled={disabled}
                    onCheckedChange={(enabled) => updateRuntime(kind, { enabled })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:pl-12">
                <Label htmlFor={inputId} className="sr-only">
                  Executable path
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={inputId}
                    value={config.executablePath}
                    disabled={disabled}
                    aria-invalid={inputInvalid}
                    aria-describedby={`${inputId}-status`}
                    placeholder={`Path to ${definition.label}`}
                    onChange={(event) =>
                      updateRuntime(kind, { executablePath: event.currentTarget.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setPickerRuntimeKind(kind)}
                  >
                    <FolderOpen data-icon="inline-start" />
                    Browse
                  </Button>
                </div>
                <p
                  id={`${inputId}-status`}
                  className={cn(
                    "text-sm",
                    inputInvalid ? "text-destructive" : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  <RuntimeStatusMessage
                    result={result}
                    isChecking={isChecking}
                    showInvalidState={showInvalidState}
                    enabled={config.enabled}
                  />
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <FolderPickerDialog
        open={pickerRuntimeKind !== null}
        onOpenChange={(open) => {
          if (!open) setPickerRuntimeKind(null);
        }}
        title="Choose runtime executable"
        description="Select the exact executable file that OpenDucktor must use."
        confirmLabel="Use executable"
        selectionMode="file"
        onConfirm={(path) => {
          if (pickerRuntimeKind) updateRuntime(pickerRuntimeKind, { executablePath: path });
          setPickerRuntimeKind(null);
        }}
      />
    </div>
  );
}
