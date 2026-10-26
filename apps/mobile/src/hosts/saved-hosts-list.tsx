import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useIsFocused } from "expo-router";
import {
  type ComponentRef,
  type ReactElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { BackHandler, type TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useHostSessionOwner } from "@/app-shell/app-services";
import type { DamagedSavedHost, SavedHost } from "@/device-data/device-records";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Callout } from "@/ui/callout";
import { DividedCard, SettingsIconTile, SettingsSection } from "@/ui/settings-layout";
import { StatusPill } from "@/ui/status-pill";
import type { ConnectionPhase } from "@/host-session/connection-phase";
import { DraftSaveBeforeSwitchError } from "@/host-session/host-session-owner";
import { useConfirmDraftLoss } from "./confirm-draft-loss";
import { ActionMenu, type ActionMenuItem } from "@/ui/action-menu";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { TextField } from "@/ui/fields";
import { focusWithKeyboard } from "@/ui/focus-with-keyboard";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { connectionPhasePill, hostAddress } from "./connection-status";

/** The action that runs on a host row: a switch to the host, or its removal. */
type HostBusy = "connect" | "remove";

const shellLabel = (shell: SavedHost["shell"]): string =>
  shell === "electron" ? "Desktop app" : "Web runner";

/** The desktop host icon (`host-picker.tsx`): a laptop for the desktop app, a server for a runner. */
function HostTile({
  shell,
  selected = false,
}: {
  shell: SavedHost["shell"];
  selected?: boolean;
}): ReactElement {
  return <SettingsIconTile icon={shell === "electron" ? "laptop" : "server"} selected={selected} />;
}

function RenameRow({ host, onDone }: { host: SavedHost; onDone: () => void }): ReactElement {
  const owner = useHostSessionOwner();
  // The field edits a draft of the label. The list keys this row by host ID.
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [label, setLabel] = useState(host.label);
  // The row opens from a menu, whose window still has the focus when the row mounts, so the
  // keyboard module opens the keyboard once the screen has the focus again.
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => focusWithKeyboard(field.current), []);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    try {
      owner.renameHost(host.id, label);
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  // Back cancels the edit first. On a tab screen, Back would open another tab and keep the edit
  // open. A sheet or a screen above this one takes the screen focus, and its Back goes to it.
  const focused = useIsFocused();
  const cancel = useEffectEvent(() => {
    onDone();
    return true;
  });
  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", cancel);
    return () => subscription.remove();
  }, [focused]);
  return (
    <View style={styles.rename}>
      <TextField
        label="Host name"
        hint={host.endpoint}
        value={label}
        onChangeText={setLabel}
        inputRef={field}
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={save}
        error={error}
      />
      <View style={styles.renameActions}>
        <Button label="Cancel" size="sm" variant="outline" onPress={onDone} />
        <Button label="Save" size="sm" disabled={label.trim().length === 0} onPress={save} />
      </View>
    </View>
  );
}

/** The third line of a host row: the connection status, the switch progress, or the host kind. */
function HostStatus({
  host,
  active,
  activePhase,
  busy,
}: {
  host: SavedHost;
  active: boolean;
  activePhase: ConnectionPhase | null;
  busy: HostBusy | null;
}): ReactElement {
  const theme = useAppTheme();
  if (active && activePhase) {
    const pill = connectionPhasePill(activePhase, host.label);
    return (
      <View style={styles.statusLine}>
        <StatusPill label={pill.label} variant={pill.variant} busy={pill.busy} />
      </View>
    );
  }
  if (busy) {
    return (
      <View style={styles.statusLine}>
        <LoaderSpinner size={13} color={theme.desktop.mutedForeground} />
        <Text variant="subhead" tone="tertiary">
          {busy === "connect" ? "Connecting…" : "Removing…"}
        </Text>
      </View>
    );
  }
  return (
    <Text variant="subhead" tone="tertiary">
      {shellLabel(host.shell)}
    </Text>
  );
}

function HostRow({
  host,
  active,
  activePhase,
  busy,
  locked,
  onSelect,
  onMenu,
}: {
  host: SavedHost;
  active: boolean;
  activePhase: ConnectionPhase | null;
  /** The action that runs on this host, if any. */
  busy: HostBusy | null;
  /** True while an action runs on any host, so the row offers no second action. */
  locked: boolean;
  /** Null when the row cannot connect now: it is the active host, or a switch runs. */
  onSelect: (() => void) | null;
  onMenu: (id: string) => void;
}): ReactElement {
  const status = active && activePhase ? connectionPhasePill(activePhase, host.label).label : null;
  const label = [
    host.label,
    shellLabel(host.shell),
    host.endpoint,
    active ? "Active host" : null,
    status,
  ]
    .filter((part) => part !== null)
    .join(", ");
  const items: ActionMenuItem[] = [
    { id: "rename", title: "Rename", icon: "pencil" },
    { id: "remove", title: "Remove", icon: "trash", destructive: true },
  ];
  if (!active) items.unshift({ id: "select", title: "Connect", icon: "link" });

  const content = (
    <>
      <HostTile shell={host.shell} selected={active} />
      <View style={styles.body}>
        <Text weight="medium" numberOfLines={1}>
          {host.label}
        </Text>
        <Text variant="monoSmall" tone="tertiary" numberOfLines={1} ellipsizeMode="middle">
          {hostAddress(host.endpoint)}
        </Text>
        <HostStatus host={host} active={active} activePhase={activePhase} busy={busy} />
      </View>
    </>
  );

  return (
    <View>
      {onSelect ? (
        <Touchable
          feedback="highlight"
          onPress={onSelect}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Connects to this host"
          style={styles.row}
        >
          {content}
        </Touchable>
      ) : (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={label}
          accessibilityState={{ selected: active, busy: busy !== null }}
        >
          {content}
        </View>
      )}
      {/* The menu control sits above the row, so screen readers reach it as its own control. */}
      <View style={styles.menu}>
        {locked ? null : (
          <ActionMenu title={host.label} items={items} onSelect={onMenu}>
            <IconButton
              icon="more"
              size={20}
              color="tertiaryLabel"
              accessibilityLabel={`Actions for ${host.label}`}
              onPress={() => {}}
            />
          </ActionMenu>
        )}
      </View>
    </View>
  );
}

/** A stored entry that the app cannot use: what the app can still read, the reason, and Remove. */
function DamagedHostRow({
  entry,
  onRemove,
}: {
  entry: DamagedSavedHost;
  onRemove: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const title = entry.label ?? "Unnamed host";
  return (
    <View style={styles.damagedRow}>
      <SettingsIconTile icon="triangle-alert" color={theme.desktop.destructiveAccent} />
      <View style={styles.body}>
        <View
          style={styles.damagedText}
          accessible
          accessibilityLabel={[title, entry.endpoint, "Damaged", entry.reason]
            .filter((part) => part !== null)
            .join(", ")}
        >
          <Text weight="medium" numberOfLines={1}>
            {title}
          </Text>
          {entry.endpoint ? (
            <Text variant="monoSmall" tone="tertiary" numberOfLines={1} ellipsizeMode="middle">
              {entry.endpoint}
            </Text>
          ) : null}
          <View style={styles.statusLine}>
            <StatusPill label="Damaged" variant="danger" />
          </View>
          <Text variant="subhead" tone="secondary">
            {entry.reason}
          </Text>
        </View>
        <View style={styles.damagedActions}>
          <Button
            label="Remove"
            icon="trash"
            variant="outline"
            size="sm"
            accessibilityLabel={`Remove ${title}`}
            onPress={onRemove}
          />
        </View>
      </View>
    </View>
  );
}

/** The stored entries that the app cannot use. Each one stays until the user removes it. */
function DamagedHostsSection({
  entries,
}: {
  entries: readonly DamagedSavedHost[];
}): ReactElement | null {
  const owner = useHostSessionOwner();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  if (entries.length === 0) return null;

  const remove = async (entry: DamagedSavedHost) => {
    const confirmed = await confirm({
      title: `Remove ${entry.label ?? "this damaged host"}?`,
      message:
        "The app deletes this damaged host and all data that it stored for it, including unsent drafts. Work on the host continues.",
      confirmLabel: "Remove Host",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    try {
      owner.removeDamagedHost(entry.key);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <SettingsSection
      title="Damaged hosts"
      description="The app cannot use these saved hosts. Remove them, and add the hosts again if you need them."
    >
      <DividedCard>
        {entries.map((entry) => (
          <DamagedHostRow key={entry.key} entry={entry} onRemove={() => void remove(entry)} />
        ))}
      </DividedCard>
      {error ? (
        <Callout tone="destructive" title="Could not remove the damaged host" message={error} />
      ) : null}
    </SettingsSection>
  );
}

/** The dashed empty box of the desktop (`diagnostics-panel-sections.tsx`), with the next step. */
function NoOtherHosts({ onAddHost }: { onAddHost: () => void }): ReactElement {
  return (
    <View style={styles.empty}>
      <Icon name="server" size={24} color="tertiaryLabel" />
      <Text variant="subhead" tone="tertiary" style={styles.emptyText}>
        Add another computer that runs OpenDucktor to switch between hosts.
      </Text>
      {/* A button hugs the start edge, so a wrapper lets this box center it. */}
      <View>
        <Button label="Add Host" icon="plus" variant="outline" size="sm" onPress={onAddHost} />
      </View>
    </View>
  );
}

/**
 * The hosts other than the active one, or all hosts without an active host. With no row, no Add
 * Host action, and no failure, as on the setup screen with only damaged entries, it shows nothing.
 */
function OtherHostsSection({
  hasActiveHost,
  rows,
  onAddHost,
  failure,
}: {
  hasActiveHost: boolean;
  rows: ReactElement[];
  onAddHost: (() => void) | undefined;
  failure: { title: string; message: string } | null;
}): ReactElement | null {
  if (rows.length === 0 && !onAddHost && !failure) return null;
  return (
    <SettingsSection
      title={hasActiveHost ? "Other hosts" : "Saved hosts"}
      description={
        hasActiveHost
          ? "Work on these hosts keeps running. Tap a host to switch to it."
          : "Tap a host to connect to it."
      }
    >
      {rows.length > 0 ? (
        <DividedCard>{rows}</DividedCard>
      ) : onAddHost ? (
        <NoOtherHosts onAddHost={onAddHost} />
      ) : null}
      {failure ? (
        <Callout tone="destructive" title={failure.title} message={failure.message} />
      ) : null}
    </SettingsSection>
  );
}

/**
 * The saved hosts of this device, as the desktop host picker: the selected host, then the other
 * hosts. Only one host is connected at a time. Selecting another host releases the current
 * connection; host work continues. Without an active host, all hosts show as saved hosts.
 */
export function SavedHostsList({
  hosts,
  damagedHosts,
  activeHostId,
  activePhase = null,
  onAddHost,
}: {
  hosts: readonly SavedHost[];
  /** The stored entries that the app cannot use, after the hosts. */
  damagedHosts: readonly DamagedSavedHost[];
  activeHostId: string | null;
  /** The connection state of the active host. */
  activePhase?: ConnectionPhase | null | undefined;
  /** Shows an Add Host action when no other host is saved. */
  onAddHost?: (() => void) | undefined;
}): ReactElement {
  const owner = useHostSessionOwner();
  const confirm = useConfirm();
  const confirmDraftLoss = useConfirmDraftLoss();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<{
    hostId: string;
    action: HostBusy;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState<{ hostId: string; action: HostBusy } | null>(null);

  const select = async (host: SavedHost, discardUnsavedDrafts = false) => {
    setBusy({ hostId: host.id, action: "connect" });
    setError(null);
    try {
      await owner.selectHost(host.id, { discardUnsavedDrafts });
    } catch (cause) {
      if (cause instanceof DraftSaveBeforeSwitchError) {
        const proceed = await confirmDraftLoss(cause);
        if (proceed) await select(host, true);
        return;
      }
      setError({
        hostId: host.id,
        action: "connect",
        message: errorMessage(cause),
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (host: SavedHost) => {
    const confirmed = await confirm({
      title: `Remove ${host.label}?`,
      message:
        "The app deletes this host and all data that it stored for it, including unsent drafts. Work on the host continues.",
      confirmLabel: "Remove Host",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy({ hostId: host.id, action: "remove" });
    setError(null);
    try {
      await owner.removeHost(host.id);
    } catch (cause) {
      setError({
        hostId: host.id,
        action: "remove",
        message: errorMessage(cause),
      });
    } finally {
      setBusy(null);
    }
  };

  const renderHost = (host: SavedHost): ReactElement =>
    renaming === host.id ? (
      <RenameRow key={host.id} host={host} onDone={() => setRenaming(null)} />
    ) : (
      <HostRow
        key={host.id}
        host={host}
        active={host.id === activeHostId}
        activePhase={host.id === activeHostId ? activePhase : null}
        busy={busy?.hostId === host.id ? busy.action : null}
        locked={busy !== null}
        onSelect={host.id === activeHostId || busy !== null ? null : () => void select(host)}
        onMenu={(id) => {
          if (id === "select") void select(host);
          if (id === "rename") setRenaming(host.id);
          if (id === "remove") void remove(host);
        }}
      />
    );

  const activeHost = hosts.find((host) => host.id === activeHostId);
  const otherHosts = hosts.filter((host) => host.id !== activeHostId);
  const failedHost = error ? hosts.find((host) => host.id === error.hostId) : undefined;
  const failure =
    error && failedHost
      ? {
          title: `${error.action === "remove" ? "Could not remove" : "Could not switch to"} ${failedHost.label}`,
          message: error.message,
        }
      : null;

  return (
    <View style={styles.sections}>
      {activeHost ? (
        <SettingsSection title="Current host" description="The app connects to one host at a time.">
          <DividedCard>{renderHost(activeHost)}</DividedCard>
        </SettingsSection>
      ) : null}
      <OtherHostsSection
        hasActiveHost={activeHost !== undefined}
        rows={otherHosts.map(renderHost)}
        onAddHost={onAddHost}
        failure={failure}
      />
      <DamagedHostsSection entries={damagedHosts} />
    </View>
  );
}

const MENU_WIDTH = 44;

const styles = StyleSheet.create((theme) => ({
  sections: { gap: theme.space.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingLeft: theme.space.lg,
    paddingRight: theme.space.xs + MENU_WIDTH,
    paddingVertical: 14,
    backgroundColor: theme.desktop.card,
  },
  body: { flex: 1, minWidth: 0, gap: theme.space.xxs },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs + 2,
    paddingTop: theme.space.xxs,
  },
  menu: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: theme.space.xs,
    width: MENU_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  rename: {
    gap: theme.space.md,
    padding: theme.space.lg,
    backgroundColor: theme.desktop.card,
  },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.space.sm },
  damagedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: 14,
    backgroundColor: theme.desktop.card,
  },
  damagedText: { gap: theme.space.xxs },
  damagedActions: { flexDirection: "row", paddingTop: theme.space.sm },
  empty: {
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xxl,
    paddingVertical: theme.space.xxl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
  },
  emptyText: { textAlign: "center", maxWidth: 300 },
}));
