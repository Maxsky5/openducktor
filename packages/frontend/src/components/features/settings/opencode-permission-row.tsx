import {
  openCodePermissionTarget,
  openCodePermissionRuleSchema,
  type OpenCodePermissionRule,
} from "@openducktor/contracts";
import { useState, type ReactElement } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTION_OPTIONS, TARGET_OPTIONS } from "./opencode-permission-options";

type PermissionRowProps = {
  id: string;
  label: string;
  rule: OpenCodePermissionRule;
  disabled: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onChange: (rule: OpenCodePermissionRule) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
};

export function PermissionRow({
  id,
  label,
  rule,
  disabled,
  canMoveEarlier,
  canMoveLater,
  onChange,
  onMove,
  onRemove,
}: PermissionRowProps): ReactElement {
  // Keep the chosen editor while custom text passes through a built-in target name.
  const [targetMode, setTargetMode] = useState(
    () => openCodePermissionTarget(rule.permission)?.permission ?? "custom",
  );
  const parsed = openCodePermissionRuleSchema.safeParse(rule);
  const issues = parsed.success ? [] : parsed.error.issues;
  const fieldError = (field: string) => issues.find((issue) => issue.path[0] === field)?.message;
  const selectorError = fieldError("permission");
  const patternError = fieldError("pattern");
  const actionError = fieldError("action");
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-label`}
      className="grid gap-3 rounded-md border border-border p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-label`} className="text-sm font-medium text-foreground">
          {label}
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={disabled || !canMoveEarlier}
            aria-label={`Move ${label} earlier`}
            title="Move earlier"
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={disabled || !canMoveLater}
            aria-label={`Move ${label} later`}
            title="Move later"
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="destructiveGhost"
            size="icon"
            className="size-8"
            disabled={disabled}
            aria-label={`Remove ${label}`}
            title="Remove rule"
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label id={`${id}-target-label`}>Target</Label>
          <Combobox
            value={targetMode}
            options={TARGET_OPTIONS}
            disabled={disabled}
            triggerAriaLabelledBy={`${id}-target-label`}
            onValueChange={(value) => {
              setTargetMode(value);
              onChange({ ...rule, permission: value === "custom" ? "*" : value, pattern: "*" });
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label id={`${id}-action-label`}>Action</Label>
          <Combobox
            value={rule.action}
            options={ACTION_OPTIONS}
            disabled={disabled}
            triggerAriaLabelledBy={`${id}-action-label`}
            {...(actionError ? { triggerAriaDescribedBy: `${id}-action-error` } : {})}
            onValueChange={(action) => {
              const parsedAction = openCodePermissionRuleSchema.shape.action.parse(action);
              onChange({ ...rule, action: parsedAction });
            }}
          />
        </div>
      </div>
      <PermissionPatternFields
        id={id}
        rule={rule}
        targetMode={targetMode}
        disabled={disabled}
        onChange={onChange}
        selectorError={selectorError}
        patternError={patternError}
      />
      {actionError ? (
        <p id={`${id}-action-error`} className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

type PermissionPatternFieldsProps = {
  id: string;
  rule: OpenCodePermissionRule;
  targetMode: string;
  disabled: boolean;
  onChange: (rule: OpenCodePermissionRule) => void;
  selectorError: string | undefined;
  patternError: string | undefined;
};

function PermissionPatternFields({
  id,
  rule,
  targetMode,
  disabled,
  onChange,
  selectorError,
  patternError,
}: PermissionPatternFieldsProps): ReactElement {
  const target = openCodePermissionTarget(targetMode);
  return (
    <>
      {!target ? (
        <div className="grid gap-1">
          <Label htmlFor={`${id}-selector`}>Tool or MCP selector</Label>
          <Input
            id={`${id}-selector`}
            value={rule.permission}
            disabled={disabled}
            aria-invalid={Boolean(selectorError)}
            aria-describedby={selectorError ? `${id}-selector-error` : undefined}
            onChange={(event) => onChange({ ...rule, permission: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Use a native tool name, a server-prefixed MCP name such as myserver_*, or * for all
            tools.
          </p>
          {selectorError ? (
            <p id={`${id}-selector-error`} className="text-xs text-destructive">
              {selectorError}
            </p>
          ) : null}
        </div>
      ) : null}
      {target?.supportsPattern ? (
        <div className="grid gap-1">
          <Label htmlFor={`${id}-pattern`}>{target.patternLabel}</Label>
          <Input
            id={`${id}-pattern`}
            value={rule.pattern}
            disabled={disabled}
            aria-invalid={Boolean(patternError)}
            aria-describedby={patternError ? `${id}-pattern-error` : `${id}-help`}
            onChange={(event) => onChange({ ...rule, pattern: event.target.value })}
          />
        </div>
      ) : null}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {target?.help ??
          "Custom tools use whole-permission actions. A rule does not add a tool to the runtime."}
      </p>
      {patternError ? (
        <p id={`${id}-pattern-error`} className="text-xs text-destructive">
          {patternError}
        </p>
      ) : null}
    </>
  );
}
