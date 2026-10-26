import type {
  DiagnosticsCheckKey,
  DiagnosticsCheckModel,
  DiagnosticsDetailModel,
  DiagnosticsHostModel,
  DiagnosticsOverviewModel,
  DiagnosticsRuntimeEntryModel,
  DiagnosticsWorkspaceModel,
} from "@openducktor/frontend-core/diagnostics/diagnostics-panel-model";
import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Callout } from "@/ui/callout";
import { DividedCard, SettingsIconTile } from "@/ui/settings-layout";
import type { AppTheme } from "@/theme/tokens";
import { RuntimeIcon } from "@/ui/brand-icons";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import {
  DIAGNOSTICS_ISSUE_SCOPE_LABELS,
  type DiagnosticsGlyph,
  type DiagnosticsOverviewFamily,
  diagnosticsCheckErrorTone,
  diagnosticsOverviewPresentation,
  runtimeExecutableText,
} from "./diagnostics-presentation";
import { DiagnosticsStatusPill } from "./diagnostics-status-pill";

/** The desktop overview icons (`diagnostics-overview.tsx`). */
const DIAGNOSTICS_GLYPHS = {
  ok: "circle-check",
  progress: "loader-circle",
  warning: "triangle-alert",
  failed: "circle-alert",
} satisfies Record<DiagnosticsGlyph, IconName>;

const CHECK_ICONS = {
  path: "terminal",
  git: "git-branch",
  "mcp-bridge": "cable",
  "repository-setup": "folder-tree",
  "task-store": "database",
} satisfies Record<DiagnosticsCheckKey, IconName>;

/** The desktop `TONE_CLASSES` of the overview card, from the desktop status families. */
const overviewColors = (theme: AppTheme, family: DiagnosticsOverviewFamily) => {
  const { desktop } = theme;
  switch (family) {
    case "success":
      return {
        card: desktop.successSurface,
        border: withAlpha(desktop.successBorder, 0.6),
        text: desktop.successSurfaceForeground,
        iconSurface: withAlpha(desktop.successAccent, 0.15),
        icon: desktop.successAccent,
      };
    case "neutral":
      return {
        card: theme.colors.panelFill,
        border: desktop.border,
        text: desktop.foreground,
        iconSurface: desktop.muted,
        icon: desktop.mutedForeground,
      };
    case "warning":
      return {
        card: desktop.warningSurface,
        border: withAlpha(desktop.warningBorder, 0.6),
        text: desktop.warningSurfaceForeground,
        iconSurface: withAlpha(desktop.warningAccent, 0.15),
        icon: desktop.warningAccent,
      };
    case "destructive":
      return {
        card: desktop.destructiveSurface,
        border: withAlpha(desktop.destructiveBorder, 0.6),
        text: desktop.destructiveSurfaceForeground,
        iconSurface: withAlpha(desktop.destructiveAccent, 0.15),
        icon: desktop.destructiveAccent,
      };
  }
};

/** The verdict at the top of the panel, with every issue that needs attention. */
export function DiagnosticsOverview({
  overview,
}: {
  overview: DiagnosticsOverviewModel;
}): ReactElement {
  const theme = useAppTheme();
  const presentation = diagnosticsOverviewPresentation(overview.tone);
  const colors = overviewColors(theme, presentation.family);
  useAnnounce(`${overview.title}. ${overview.description}`);
  return (
    <View
      style={[styles.overview, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.overviewIcon, { backgroundColor: colors.iconSurface }]}>
        {presentation.inProgress ? (
          <LoaderSpinner size={20} color={colors.icon} />
        ) : (
          <Icon name={DIAGNOSTICS_GLYPHS[presentation.glyph]} size={20} colorValue={colors.icon} />
        )}
      </View>
      <View style={styles.overviewCopy}>
        <Text variant="headline" accessibilityRole="header" style={{ color: colors.text }}>
          {overview.title}
        </Text>
        <Text variant="subhead" style={[styles.overviewDescription, { color: colors.text }]}>
          {overview.description}
        </Text>
        {overview.issues.length > 0 ? (
          <View style={styles.issues}>
            {overview.issues.map((issue) => (
              <View key={`${issue.scope}:${issue.message}`} style={styles.issue}>
                <View
                  style={[
                    styles.scope,
                    { backgroundColor: withAlpha(theme.desktop.destructiveAccent, 0.15) },
                  ]}
                >
                  <Text variant="caption2" overline style={{ color: colors.text }}>
                    {DIAGNOSTICS_ISSUE_SCOPE_LABELS[issue.scope]}
                  </Text>
                </View>
                <Text
                  variant="subhead"
                  style={[styles.flexText, { color: colors.text }]}
                  selectable
                >
                  {issue.message}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** One labeled group of the panel, as Host or Workspace: an uppercase label and its scope. */
function DiagnosticsGroup({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>): ReactElement {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text
          variant="footnote"
          weight="semibold"
          tone="tertiary"
          overline
          accessibilityRole="header"
        >
          {title}
        </Text>
        <Text variant="footnote" tone="tertiary" numberOfLines={1} style={styles.groupDescription}>
          {description}
        </Text>
      </View>
      {children}
    </View>
  );
}

/**
 * A bordered card with a muted title bar. A hairline separates its rows. `header` replaces the
 * plain title, as the workspace name and path.
 */
function DiagnosticsCard({
  title,
  header,
  children,
}: PropsWithChildren<{ title?: string; header?: ReactNode }>): ReactElement {
  return (
    <DividedCard radius="xl">
      <View style={styles.cardTitle}>{header ?? <Text weight="medium">{title}</Text>}</View>
      {children}
    </DividedCard>
  );
}

/** A secondary fact under a row title. A path uses a monospace font and keeps both ends. */
function DiagnosticsDetail({ detail }: { detail: DiagnosticsDetailModel }): ReactElement {
  return (
    <View style={styles.detail}>
      <Text variant="footnote" tone="tertiary">
        {detail.label}
      </Text>
      <Text
        variant={detail.isPath ? "monoSmall" : "footnote"}
        tone="tertiary"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={styles.flexText}
        selectable
      >
        {detail.value}
      </Text>
    </View>
  );
}

/** The title of a row with its main result, such as a version, in a monospace font. */
function RowTitle({ title, value }: { title: string; value: string | null }): ReactElement {
  return (
    <View style={styles.rowTitle}>
      <Text weight="medium" numberOfLines={1} style={styles.shrink}>
        {title}
      </Text>
      {value ? (
        <Text
          variant="monoSmall"
          tone="tertiary"
          numberOfLines={1}
          style={styles.shrink}
          selectable
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/** Lines under a row, aligned with the row text after the icon tile. */
function RowFootnotes({ children }: PropsWithChildren): ReactElement {
  return <View style={styles.footnotes}>{children}</View>;
}

/** Marks a shown result as earlier, after a failed refresh. */
function EarlierResult({ notice }: { notice: string }): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.earlier}>
      <Icon name="history" size={12} colorValue={theme.desktop.warningMuted} />
      <Text variant="footnote" style={[styles.flexText, { color: theme.desktop.warningMuted }]}>
        {notice}
      </Text>
    </View>
  );
}

/** One shared runtime: its identity, executable, state, progress, and last failure. */
function RuntimeRow({ entry }: { entry: DiagnosticsRuntimeEntryModel }): ReactElement {
  const theme = useAppTheme();
  const executable = runtimeExecutableText(entry);
  return (
    <View style={styles.row}>
      <View style={styles.rowLine}>
        <SettingsIconTile muted={entry.status.health === "neutral"}>
          <RuntimeIcon runtimeKind={entry.kind} size={18} />
        </SettingsIconTile>
        <View style={styles.rowText}>
          <RowTitle title={entry.label} value={entry.version} />
          <Text
            variant={executable.isPath ? "monoSmall" : "footnote"}
            tone="tertiary"
            numberOfLines={1}
            ellipsizeMode="middle"
            selectable
          >
            {executable.text}
          </Text>
          {entry.effectiveExecutablePath ? (
            <DiagnosticsDetail
              detail={{ label: "In use", value: entry.effectiveExecutablePath, isPath: true }}
            />
          ) : null}
        </View>
        <DiagnosticsStatusPill subject={`${entry.label} runtime`} status={entry.status} />
      </View>
      {entry.progress || entry.failure ? (
        <RowFootnotes>
          {entry.progress ? (
            <View style={styles.progress} accessibilityLiveRegion="polite">
              <LoaderSpinner size={12} color={theme.desktop.mutedForeground} />
              <Text variant="footnote" tone="tertiary" style={styles.flexText}>
                {entry.progress}
              </Text>
            </View>
          ) : null}
          {entry.failure ? (
            <Callout
              size="sm"
              tone="destructive"
              message={entry.failure.message}
              detail={entry.failure.nextAction}
            />
          ) : null}
        </RowFootnotes>
      ) : null}
    </View>
  );
}

/** One check: its icon, the title and result, its details, and any failure. */
function CheckRow({ check }: { check: DiagnosticsCheckModel }): ReactElement {
  const errorTone = diagnosticsCheckErrorTone(check);
  return (
    <View style={styles.row}>
      <View style={styles.rowLine}>
        <SettingsIconTile icon={CHECK_ICONS[check.key]} />
        <View style={styles.rowText}>
          <RowTitle title={check.title} value={check.value} />
          {check.details.map((detail) => (
            <DiagnosticsDetail key={detail.label} detail={detail} />
          ))}
        </View>
        <DiagnosticsStatusPill subject={check.title} status={check.status} />
      </View>
      {check.notice !== null || check.errors.length > 0 ? (
        <RowFootnotes>
          {check.notice !== null ? <EarlierResult notice={check.notice} /> : null}
          {check.errors.map((error) => (
            <Callout key={error} size="sm" tone={errorTone} message={error} />
          ))}
        </RowFootnotes>
      ) : null}
    </View>
  );
}

/** Agent runtimes and the tools that every workspace of the host shares. */
export function DiagnosticsHostGroup({ host }: { host: DiagnosticsHostModel }): ReactElement {
  return (
    <DiagnosticsGroup title="Host" description="Shared by all workspaces">
      <DiagnosticsCard title="Agent runtimes">
        {host.runtimes.notice ? (
          <View style={styles.cardNotice}>
            <Callout
              size="sm"
              tone="warning"
              title="Runtime states can be out of date"
              message={host.runtimes.notice}
            />
          </View>
        ) : null}
        {host.runtimes.entries.map((entry) => (
          <RuntimeRow key={entry.kind} entry={entry} />
        ))}
      </DiagnosticsCard>
      <DiagnosticsCard title="Tools and services">
        {host.tools.map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
      </DiagnosticsCard>
    </DiagnosticsGroup>
  );
}

/** Checks of the workspace that this app shows. */
export function DiagnosticsWorkspaceGroup({
  workspace,
}: {
  workspace: DiagnosticsWorkspaceModel;
}): ReactElement {
  if (workspace.kind === "none") {
    return (
      <DiagnosticsGroup title="Workspace" description="No workspace selected">
        <View style={styles.empty}>
          <Icon name="folder-open" size={24} color="tertiaryLabel" />
          <Text variant="subhead" tone="tertiary" style={styles.emptyText}>
            {workspace.emptyMessage}
          </Text>
        </View>
      </DiagnosticsGroup>
    );
  }
  return (
    <DiagnosticsGroup title="Workspace" description="Selected workspace only">
      <DiagnosticsCard
        header={
          <View style={styles.workspaceTitle}>
            <Icon name="folder-git-2" size={16} color="tertiaryLabel" />
            <View style={styles.rowText}>
              <Text weight="medium" numberOfLines={1}>
                {workspace.name}
              </Text>
              <Text
                variant="monoSmall"
                tone="tertiary"
                numberOfLines={1}
                ellipsizeMode="middle"
                selectable
              >
                {workspace.path}
              </Text>
            </View>
          </View>
        }
      >
        {workspace.checks.map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
      </DiagnosticsCard>
    </DiagnosticsGroup>
  );
}

const TILE = 36;

const styles = StyleSheet.create((theme) => ({
  flexText: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  overview: {
    flexDirection: "row",
    gap: theme.space.md,
    padding: theme.space.lg,
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
  },
  overviewIcon: {
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewCopy: { flex: 1, minWidth: 0, gap: theme.space.xs },
  overviewDescription: { opacity: 0.8 },
  issues: { gap: 6, paddingTop: 6 },
  issue: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  scope: {
    marginTop: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.xs,
    borderCurve: "continuous",
  },
  group: { gap: 10 },
  groupHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xs,
  },
  groupDescription: { flexShrink: 1, textAlign: "right" },
  cardTitle: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: 10,
    backgroundColor: theme.colors.panelFill,
  },
  cardNotice: { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
  row: { gap: 10, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
  rowLine: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  rowText: { flex: 1, minWidth: 0, gap: theme.space.xxs },
  rowTitle: { flexDirection: "row", alignItems: "baseline", gap: theme.space.sm },
  detail: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  footnotes: { gap: theme.space.sm, paddingLeft: TILE + theme.space.md },
  earlier: { flexDirection: "row", alignItems: "center", gap: 6 },
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  workspaceTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  empty: {
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xxl,
    paddingVertical: theme.space.xxl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
  },
  emptyText: { textAlign: "center", maxWidth: 320 },
}));
