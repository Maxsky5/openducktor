import type {
  AgentRuntimes,
  RuntimeDescriptor,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";
import { FolderOpen, RefreshCw } from "lucide-react";
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
          const inputId = `runtime-executable-${kind}`;
          return (
            <section
              key={kind}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              aria-labelledby={`${inputId}-title`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 id={`${inputId}-title`} className="truncate font-semibold text-foreground">
                    {definition.label}
                  </h3>
                  <Badge variant={result?.ok ? "secondary" : "outline"}>
                    {result?.ok ? "Available" : "Unavailable"}
                  </Badge>
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

              <div className="flex flex-col gap-2">
                <Label htmlFor={inputId}>Executable path</Label>
                <div className="flex gap-2">
                  <Input
                    id={inputId}
                    value={config.executablePath}
                    disabled={disabled}
                    aria-invalid={config.enabled && result?.ok !== true}
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
                    result?.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                  aria-live="polite"
                >
                  {result?.ok
                    ? `${result.version ?? "Executable is ready"} at ${result.path}`
                    : (result?.error ?? "Enter a path, then check it.")}
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
