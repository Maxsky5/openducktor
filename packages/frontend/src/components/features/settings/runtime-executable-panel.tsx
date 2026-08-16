import type { AgentRuntimes, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { CircleAlert, CircleCheck, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { FolderPickerDialog } from "@/components/features/repository/folder-picker-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { runtimeExecutableResultForPath } from "@/state/operations/runtime-executables/runtime-executable-validation";
import type { RuntimeExecutableValidationResult } from "@/state/queries/use-runtime-executable-validation";

type RuntimeExecutablePanelProps = {
  runtimes: AgentRuntimes;
  definitions: RuntimeDescriptor[];
  results: RuntimeExecutableValidationResult[];
  disabled?: boolean;
  isChecking?: boolean;
  checkingRuntimeKinds?: readonly RuntimeKind[];
  checkAgainPlacement?: "panel" | "runtime-status" | "hidden";
  focusRuntimeKind?: RuntimeKind | null;
  onFocusRuntimeHandled?: (runtimeKind: RuntimeKind) => void;
  onChange: (next: AgentRuntimes) => void;
  onCheckAgain: () => void;
};

const executableDirectory = (executablePath: string): string | undefined => {
  const path = executablePath.trim();
  if (!path) return undefined;

  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separatorIndex < 0) return undefined;
  if (separatorIndex === 0) return path.slice(0, 1);
  if (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(path)) return path.slice(0, 3);
  return path.slice(0, separatorIndex);
};

type RuntimeStatusProps = {
  result: RuntimeExecutableValidationResult | undefined;
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
        {result.version ?? "Executable is ready"}
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

function CheckAgainButton({
  disabled,
  isChecking,
  onCheckAgain,
}: {
  disabled: boolean;
  isChecking: boolean;
  onCheckAgain: () => void;
}): ReactElement {
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={onCheckAgain}>
      <RefreshCw data-icon="inline-start" />
      {isChecking ? "Checking..." : "Check again"}
    </Button>
  );
}

export function RuntimeExecutablePanel({
  runtimes,
  definitions,
  results,
  disabled = false,
  isChecking = false,
  checkingRuntimeKinds = [],
  checkAgainPlacement = "panel",
  focusRuntimeKind = null,
  onFocusRuntimeHandled,
  onChange,
  onCheckAgain,
}: RuntimeExecutablePanelProps): ReactElement {
  const [pickerRuntimeKind, setPickerRuntimeKind] = useState<RuntimeKind | null>(null);
  const inputRefs = useRef<Partial<Record<RuntimeKind, HTMLInputElement | null>>>({});
  const checkingRuntimeKindSet = new Set(checkingRuntimeKinds);
  const isAnyRuntimeChecking = isChecking || checkingRuntimeKinds.length > 0;
  const pickerInitialPath = pickerRuntimeKind
    ? executableDirectory(runtimes[pickerRuntimeKind].executablePath)
    : undefined;

  useEffect(() => {
    if (!focusRuntimeKind) return;
    const input = inputRefs.current[focusRuntimeKind];
    if (!input) return;
    input.focus();
    onFocusRuntimeHandled?.(focusRuntimeKind);
  }, [focusRuntimeKind, onFocusRuntimeHandled]);

  const updateRuntime = (kind: RuntimeKind, update: Partial<AgentRuntimes[RuntimeKind]>): void => {
    onChange({
      ...runtimes,
      [kind]: { ...runtimes[kind], ...update },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {checkAgainPlacement === "panel" ? (
        <div className="flex justify-end">
          <CheckAgainButton
            disabled={disabled || isAnyRuntimeChecking}
            isChecking={isChecking}
            onCheckAgain={onCheckAgain}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {definitions.map((definition) => {
          const kind = definition.kind;
          const config = runtimes[kind];
          const result = runtimeExecutableResultForPath(kind, config.executablePath, results);
          const isRuntimeChecking = isChecking || checkingRuntimeKindSet.has(kind);
          const hasInvalidResult = result?.ok === false;
          const showInvalidState = !isRuntimeChecking && hasInvalidResult;
          const inputInvalid = config.enabled && showInvalidState;
          const inputId = `runtime-executable-${kind}`;
          return (
            <section
              key={kind}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-4",
                inputInvalid ? "border-destructive-border" : "border-border",
              )}
              aria-labelledby={`${inputId}-title`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    data-runtime-logo={kind}
                    className="flex size-9 shrink-0 items-center justify-center text-foreground"
                  >
                    <AgentRuntimeIcon runtimeKind={kind} className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 id={`${inputId}-title`} className="truncate font-semibold text-foreground">
                      {definition.label}
                    </h3>
                    <RuntimeStatusBadge
                      result={result}
                      isChecking={isRuntimeChecking}
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
                    ref={(input) => {
                      inputRefs.current[kind] = input;
                    }}
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
                <div
                  data-runtime-status-row={kind}
                  className="flex min-h-9 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p
                    id={`${inputId}-status`}
                    className={cn(
                      "min-w-0 flex-1 text-sm",
                      inputInvalid ? "text-destructive" : "text-muted-foreground",
                    )}
                    aria-live="polite"
                  >
                    <RuntimeStatusMessage
                      result={result}
                      isChecking={isRuntimeChecking}
                      showInvalidState={showInvalidState}
                      enabled={config.enabled}
                    />
                  </p>
                  {checkAgainPlacement === "runtime-status" ? (
                    <CheckAgainButton
                      disabled={disabled || isAnyRuntimeChecking}
                      isChecking={isChecking}
                      onCheckAgain={onCheckAgain}
                    />
                  ) : null}
                </div>
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
        title="Choose coding agent executable"
        description="Select the exact executable file that OpenDucktor must use."
        confirmLabel="Use executable"
        selectionMode="file"
        {...(pickerInitialPath ? { initialPath: pickerInitialPath } : {})}
        onConfirm={(path) => {
          if (pickerRuntimeKind) updateRuntime(pickerRuntimeKind, { executablePath: path });
          setPickerRuntimeKind(null);
        }}
      />
    </div>
  );
}
