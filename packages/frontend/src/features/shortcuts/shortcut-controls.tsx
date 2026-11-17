import type { ShortcutActionId } from "@openducktor/contracts";
import { createContext, use, useMemo, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useShortcutLabel } from "./use-shortcut-label";
import { commandDefinition } from "./catalogue";

const ShortcutOwnersContext = createContext<readonly string[]>([]);

/** Portalled controls keep their registration owners through React context. */
export function ShortcutScope({
  owners,
  children,
}: {
  owners: readonly string[];
  children: ReactNode;
}) {
  // Callers pass a new array each render; the context keeps one value while the owners stay the
  // same, so its consumers do not render again.
  const key = owners.join("\n");
  const value = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);
  return <ShortcutOwnersContext value={value}>{children}</ShortcutOwnersContext>;
}

function useControlShortcutLabel(
  id: ShortcutActionId | undefined,
  available: boolean,
  owner?: string,
): string | null {
  const owners = use(ShortcutOwnersContext);
  const label = useShortcutLabel(id, "control", owner ? [owner] : owners);
  return available ? label : null;
}

export function useShortcutTitle(
  id: ShortcutActionId | undefined,
  title: string | undefined,
  available = true,
  owner?: string,
): string | undefined {
  const label = useControlShortcutLabel(id, available, owner);
  if (!label) return title;
  return title ? `${title} (${label})` : label;
}

/** Keeps the visible action name separate from its current assignment. */
export function ShortcutHint({
  id,
  available = true,
}: {
  id: ShortcutActionId | undefined;
  available?: boolean;
}) {
  const label = useControlShortcutLabel(id, available);
  return label ? (
    <span aria-hidden="true" className="ml-auto pl-3 font-mono text-xs opacity-75">
      {" "}
      {label}
    </span>
  ) : null;
}

export function ShortcutButton({
  shortcutId,
  title,
  children,
  ...props
}: ComponentProps<typeof Button> & { shortcutId: ShortcutActionId | undefined }) {
  const actionTitle =
    title ?? props["aria-label"] ?? (shortcutId ? commandDefinition(shortcutId)?.label : undefined);
  const effectiveTitle = useShortcutTitle(
    shortcutId,
    actionTitle,
    !props.disabled && props["aria-disabled"] !== true && props["aria-disabled"] !== "true",
  );
  return (
    <Button {...props} title={effectiveTitle}>
      {children}
    </Button>
  );
}

export function ShortcutMenuItem({
  shortcutId,
  children,
  ...props
}: ComponentProps<typeof ContextMenuItem> & { shortcutId: ShortcutActionId | undefined }) {
  return (
    <ContextMenuItem {...props}>
      {children}
      <ShortcutHint id={shortcutId} available={!props.disabled} />
    </ContextMenuItem>
  );
}

export function ShortcutText({
  id,
  available = true,
  children,
}: {
  id: ShortcutActionId | undefined;
  available?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <ShortcutHint id={id} available={available} />
    </>
  );
}
