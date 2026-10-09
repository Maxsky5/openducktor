import {
  CLAUDE_INITIAL_TOOL_AVAILABILITY,
  CLAUDE_RESERVED_TOOL_LIMITS,
  type ClaudeToolAvailability,
  type ClaudeToolCatalog,
} from "@openducktor/contracts";
import { useId, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ClaudeToolList({
  scopeLabel,
  choices,
  catalog,
  disabled,
  onChange,
}: Props): ReactElement {
  const id = useId();
  const [search, setSearch] = useState("");
  const tools = new Map(catalog?.tools.map((tool) => [tool.name, tool]));
  const term = search.toLowerCase();
  const names = [
    ...new Set([
      ...tools.keys(),
      ...Object.keys(CLAUDE_INITIAL_TOOL_AVAILABILITY),
      ...Object.keys(choices),
    ]),
  ]
    .sort()
    .filter((name) => name.toLowerCase().includes(term));
  const searchLabel =
    scopeLabel === "Default" ? "Search Claude tools" : `Search ${scopeLabel} Claude tools`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-search`}>{searchLabel}</Label>
      <Input
        id={`${id}-search`}
        value={search}
        disabled={disabled}
        placeholder="Search by tool name"
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-96 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {names.map((name) => {
          const tool = tools.get(name);
          const reserved = CLAUDE_RESERVED_TOOL_LIMITS.find((limit) => limit.name === name);
          const canDisable = !reserved && tool?.canDisable !== false;
          const limitation = tool?.limitation ?? reserved?.limitation;
          const enabled = choices[name] !== false;
          const rowId = `${id}-${name}`;
          return (
            <div key={name} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={rowId} className="break-all">
                  {name}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "Enabled by preference" : "Disabled by preference"}
                </p>
                {catalog && !tool && (
                  <p className="text-xs text-muted-foreground">Unavailable in this catalog</p>
                )}
                {limitation && <p className="text-xs text-muted-foreground">{limitation}</p>}
              </div>
              {!canDisable && !enabled && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`Remove ${scopeLabel} ${name} exclusion`}
                  onClick={() => onChange({ ...choices, [name]: true })}
                >
                  Remove saved exclusion
                </Button>
              )}
              {canDisable && (
                <Switch
                  id={rowId}
                  checked={enabled}
                  disabled={disabled}
                  aria-label={`${scopeLabel} ${name}`}
                  onCheckedChange={(next) => onChange({ ...choices, [name]: next })}
                />
              )}
            </div>
          );
        })}
        {names.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No tools match the search.</p>
        )}
      </div>
    </div>
  );
}

type Props = {
  scopeLabel: string;
  choices: ClaudeToolAvailability;
  catalog: ClaudeToolCatalog | undefined;
  disabled: boolean;
  onChange: (choices: ClaudeToolAvailability) => void;
};
