import type { RepoAction } from "@openducktor/contracts";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { Stack, useRouter } from "expo-router";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkHeaderTitle } from "@/features/work-owner/work-header-title";
import { toWorkOwnerParams } from "@/features/work-owner/work-owner-params";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { SkeletonFrame, TextPlaceholder } from "@/ui/placeholders";
import { useScreenEndSpace } from "@/ui/screen";
import { EmptyState, ErrorState } from "@/ui/states";
import { ListSection } from "@/ui/surfaces";
import { Text } from "@/ui/text";
import { useWideLayout } from "@/ui/use-wide-layout";
import { TerminalLauncher } from "./terminal-launcher";
import { buildTerminalRows, terminalLimitText } from "./terminal-list-model";
import { TerminalNoticeStrip, TerminalTransportNotice } from "./terminal-notice-strip";
import { TerminalPane } from "./terminal-pane";
import { TerminalRow, TerminalRowPlaceholder } from "./terminal-row";
import { useOwnerTerminals } from "./use-owner-terminals";
import { useTerminalClose } from "./use-terminal-close";

/** The Terminals view of a task or chat. */
export function TerminalsScreen(): ReactElement {
  return (
    <WorkOwnerScreen
      title="Terminals"
      diffs={false}
      background="grouped"
      skeleton={<TerminalsSkeleton />}
    >
      {(owner) => <TerminalsContent owner={owner} />}
    </WorkOwnerScreen>
  );
}

function TerminalsContent({ owner }: { owner: WorkOwner }): ReactElement {
  const router = useRouter();
  // Tablets and wide landscape show the terminal list and the selected terminal side by side.
  const wide = useWideLayout();
  const model = useOwnerTerminals(owner);
  const ownerParams = useMemo(() => toWorkOwnerParams(owner.ref), [owner.ref]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  // A start opens its terminal once the host started it. The tab ID is never shown.
  const openOnStartTabId = useRef<string | null>(null);

  const openTerminal = useCallback(
    (terminalId: string) => {
      if (wide) setSelectedTerminalId(terminalId);
      else router.push(routes.terminal(ownerParams, terminalId));
    },
    [ownerParams, router, wide],
  );
  useEffect(() => {
    if (openOnStartTabId.current === null) return;
    const started = model.tabs.find((tab) => tab.tabId === openOnStartTabId.current);
    if (started?.requestState === "creating") return;
    openOnStartTabId.current = null;
    if (started?.requestState === "ready") openTerminal(started.terminalId);
  }, [model.tabs, openTerminal]);

  const onClosed = useCallback(
    (tab: TerminalTab) => {
      // A lost tab keeps the ID of its terminal in `sourceTerminalId`.
      const closedId = tab.requestState === "lost" ? tab.sourceTerminalId : tab.terminalId;
      if (closedId !== null && closedId === selectedTerminalId) setSelectedTerminalId(null);
    },
    [selectedTerminalId],
  );
  const { close, closeUnknown } = useTerminalClose(model, onClosed);
  const start = useCallback(
    (action?: RepoAction) => {
      const tabId = model.createTerminal(action);
      if (tabId !== null) openOnStartTabId.current = tabId;
    },
    [model],
  );
  const gate = useCommandGate();
  const startBlocked = model.startBlockedReason;
  const options = useMemo(
    () => ({
      title: "Terminals",
      headerTitle: () => (
        <WorkHeaderTitle title="Terminals" subtitle={owner.title} subtitleEllipsis="tail" />
      ),
      // The main action of the view, as the New tab control of the desktop panel.
      headerRight: () => (
        <IconButton
          icon="plus"
          variant="primary"
          command
          disabled={startBlocked !== null || !gate.open}
          accessibilityLabel="New terminal"
          onPress={() => start()}
        />
      ),
    }),
    [gate.open, owner.title, start, startBlocked],
  );

  const list = (
    <TerminalList
      owner={owner}
      model={model}
      selectedTerminalId={wide ? selectedTerminalId : null}
      pushesTerminal={!wide}
      closeUnknown={closeUnknown}
      onOpen={openTerminal}
      onClose={close}
      onStart={start}
    />
  );
  return (
    <>
      <Stack.Screen options={options} />
      {wide ? (
        <View style={styles.split}>
          <View style={styles.listPane}>{list}</View>
          <View style={styles.detailPane}>
            {selectedTerminalId === null ? (
              <EmptyState
                icon="square-terminal"
                title="No Terminal Selected"
                message="Select a terminal to attach to it."
              />
            ) : (
              <TerminalPane
                model={model}
                terminalId={selectedTerminalId}
                onRemoveLost={(tab) => void close(tab)}
              />
            )}
          </View>
        </View>
      ) : (
        list
      )}
    </>
  );
}

function TerminalList({
  owner,
  model,
  selectedTerminalId,
  pushesTerminal,
  closeUnknown,
  onOpen,
  onClose,
  onStart,
}: {
  owner: WorkOwner;
  model: TerminalSessionsModel;
  selectedTerminalId: string | null;
  pushesTerminal: boolean;
  closeUnknown: ReadonlyMap<string, string>;
  onOpen: (terminalId: string) => void;
  onClose: (tab: TerminalTab) => Promise<void>;
  onStart: (action?: RepoAction) => void;
}): ReactElement {
  const gate = useCommandGate();
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const {
    tabs,
    closingTabIds,
    runningCommandTerminalIds,
    activityStatus,
    onRetryCreate,
    scopeKey,
  } = model;
  const rows = useMemo(
    () => buildTerminalRows({ tabs, closingTabIds, runningCommandTerminalIds, activityStatus }),
    [activityStatus, closingTabIds, runningCommandTerminalIds, tabs],
  );
  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((entry) => entry.tabId === tabId);
      if (tab) void onClose(tab);
    },
    [onClose, tabs],
  );
  const retry = useCallback(
    (tabId: string) => {
      const tab = tabs.find((entry) => entry.tabId === tabId);
      if (
        !tab ||
        scopeKey === null ||
        tab.requestState === "ready" ||
        tab.requestState === "lost"
      ) {
        return;
      }
      onRetryCreate(scopeKey, tab.tabId, tab.actionId);
    },
    [onRetryCreate, scopeKey, tabs],
  );

  let terminals: ReactElement;
  if (model.discoveryError !== null && rows.length === 0) {
    terminals = (
      <ErrorState
        title="Terminal Discovery Failed"
        message={model.discoveryError}
        onRetry={gate.open ? model.onRetryDiscovery : undefined}
        retryLabel="Retry Discovery"
      />
    );
  } else if (rows.length === 0 && !model.isSynced) {
    terminals = <TerminalListSkeleton />;
  } else if (rows.length === 0) {
    terminals = <NoTerminals />;
  } else {
    terminals = (
      <ListSection
        title="Open terminals"
        trailing={
          <Text variant="caption2" tone="tertiary" tabular>
            {terminalLimitText(model)}
          </Text>
        }
        first
      >
        {rows.map((row, index) => (
          <TerminalRow
            key={row.tabId}
            row={row}
            first={index === 0}
            selected={row.terminalId !== null && row.terminalId === selectedTerminalId}
            disclosure={pushesTerminal}
            closeUnknownGuidance={closeUnknown.get(row.tabId) ?? null}
            startBlockedReason={model.startBlockedReason}
            onOpen={onOpen}
            onClose={closeTab}
            onRetry={retry}
          />
        ))}
      </ListSection>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // The safe area sets this end padding. It changes only on rotation and moves no row.
      // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
      contentContainerStyle={{ paddingBottom: endSpace }}
    >
      {/* The status strips of the desktop terminal panel, above the terminals. */}
      {model.discoveryError !== null && rows.length > 0 ? (
        <TerminalNoticeStrip
          tone="error"
          edge="top"
          title="Terminal discovery failed."
          message={`${model.discoveryError} The list shows the last loaded terminals.`}
          action={
            <Button
              label="Retry"
              size="sm"
              variant="outline"
              disabled={!gate.open || model.isLoading}
              accessibilityLabel="Retry terminal discovery"
              onPress={model.onRetryDiscovery}
            />
          }
        />
      ) : null}
      {model.transportError !== null ? (
        <TerminalTransportNotice message={model.transportError} />
      ) : null}
      {/* A plain box keeps an empty or error state at its content height, above Start. */}
      <View>{terminals}</View>
      <TerminalLauncher owner={owner} model={model} onStart={onStart} />
    </ScrollView>
  );
}

/**
 * The open terminals for their first load, in the layout of the loaded section: its title and
 * terminal rows. The section then takes the place of each part.
 */
/** The Terminals screen while its owner loads: the open terminals section for its first load. */
function TerminalsSkeleton(): ReactElement {
  return (
    <ScrollView scrollEnabled={false} contentInsetAdjustmentBehavior="automatic">
      <TerminalListSkeleton />
    </ScrollView>
  );
}

function TerminalListSkeleton(): ReactElement {
  return (
    <SkeletonFrame label="Loading terminals">
      <ListSection
        title="Open terminals"
        trailing={<TextPlaceholder variant="caption2" width={92} />}
        first
      >
        <TerminalRowPlaceholder first titleWidth="46%" />
        <TerminalRowPlaceholder first={false} titleWidth="34%" />
      </ListSection>
    </SkeletonFrame>
  );
}

/** No open terminal: a short line above the start choices, as the empty desktop panel. */
function NoTerminals(): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.empty} accessible accessibilityRole="text">
      <Icon name="square-terminal" size={20} colorValue={theme.desktop.mutedForeground} />
      <View style={styles.emptyCopy}>
        <Text weight="medium">No open terminals</Text>
        <Text variant="subhead" style={styles.emptyText}>
          Start a shell or run a repository action. Terminals keep running on the host.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  split: { flex: 1, flexDirection: "row" },
  listPane: {
    width: "40%",
    minWidth: 300,
    maxWidth: 440,
    borderRightWidth: theme.hairline,
    borderRightColor: theme.desktop.border,
  },
  detailPane: { flex: 1 },
  empty: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.lg,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.border,
  },
  emptyCopy: { flex: 1, gap: 2 },
  emptyText: { color: theme.desktop.mutedForeground },
}));
