import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TARGETS = [
  { value: "tools", label: "Tools", example: "Read" },
  { value: "commands", label: "Commands", example: "Bash(git status)" },
  { value: "files", label: "File paths", example: "Read(./src/**)" },
  { value: "domains", label: "Network domains", example: "WebFetch(domain:example.com)" },
  { value: "mcp", label: "MCP tools", example: "mcp__github__*" },
  { value: "agents", label: "Subagents", example: "Agent(Explore)" },
];

const ruleTarget = (rule: string): string => {
  if (rule.startsWith("mcp__")) return "mcp";
  if (rule.startsWith("Agent")) return "agents";
  if (/^(Bash|PowerShell)\(/.test(rule)) return "commands";
  if (/^(Read|Edit)\(/.test(rule)) return "files";
  if (rule.startsWith("WebFetch(")) return "domains";
  return "tools";
};

export function ClaudeListEditor({
  id,
  label,
  value,
  disabled,
  rules,
  action,
  onChange,
  invalidIndices,
}: {
  id: string;
  label: string;
  value: string[];
  disabled: boolean;
  rules: boolean;
  action?: string | undefined;
  invalidIndices: number[];
  onChange: (value: string[]) => void;
}) {
  const rowId = useId();
  const nextRow = useRef(value?.length ?? 0);
  const [rows, setRows] = useState(() =>
    (value ?? []).map((entry, index) => ({ id: `${rowId}-${index}`, target: ruleTarget(entry) })),
  );
  const [target, setTarget] = useState("tools");
  const invalidIndexSet = new Set(invalidIndices);
  const selectedTarget = TARGETS.find((entry) => entry.value === target)!;
  const groups = rules ? TARGETS : [{ value: "tools", label, example: "" }];
  const addEntry = () => {
    setRows([...rows, { id: `${rowId}-${nextRow.current++}`, target }]);
    onChange([
      ...(value ?? []),
      rules ? (target === "agents" && action !== "deny" ? "Agent" : selectedTarget.example) : "",
    ]);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? "No OpenDucktor entries. Native entries remain."
          : "Native entries remain in effect."}
      </p>
      {groups.map((group) => {
        const indices = value
          .map((_, index) => index)
          .filter((index) => !rules || rows[index]?.target === group.value);
        if (!indices.length) return null;
        return (
          <div key={group.value} className="flex flex-col gap-2">
            {rules && <h4 className="text-xs font-medium">{group.label}</h4>}
            {indices.map((index) => (
              <div key={rows[index]?.id} className="flex items-center gap-2">
                <Input
                  aria-label={`${label} entry ${index + 1}`}
                  aria-describedby={`${id}-help`}
                  value={value[index]}
                  aria-invalid={invalidIndexSet.has(index)}
                  placeholder={rules ? group.example : "Enter a native pattern or path"}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      value.map((current, i) => (i === index ? event.target.value : current)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setRows(rows.filter((_, i) => i !== index));
                    onChange(value.filter((_, i) => i !== index));
                  }}
                  aria-label={`Remove ${label} entry ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {rules && (
          <div className="min-w-0 flex-1 basis-48">
            <Label id={`${id}-target`} className="sr-only">
              {label} rule target
            </Label>
            <Combobox
              value={target}
              options={TARGETS}
              disabled={disabled}
              triggerAriaLabelledBy={`${id}-target`}
              onValueChange={setTarget}
            />
          </div>
        )}
        <Button type="button" variant="outline" disabled={disabled} onClick={addEntry}>
          Add entry
        </Button>
      </div>
      {rules && (
        <p className="text-xs text-muted-foreground">
          Example:{" "}
          <code>{target === "agents" && action !== "deny" ? "Agent" : selectedTarget.example}</code>
          .{target === "agents" && " Named subagents require a Deny rule."}
        </p>
      )}
    </div>
  );
}
