import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { formatCiRelativeTime } from "@openducktor/frontend-core/review/task-execution-ci-relative-time-format";
import {
  commentLocationLabel,
  isBotCommentAuthor,
  REVIEW_OUTCOME_PRESENTATION,
} from "@openducktor/frontend-core/review/task-execution-ci-presentation";
import { Image } from "expo-image";
import { memo, type ReactElement, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { buildFileDiffRows } from "@/rich-content/diff/diff-row-model";
import { DiffRowView } from "@/rich-content/diff/diff-rows";
import { MarkdownView } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { CollapseChevron } from "@/ui/collapse-chevron";
import { multiplyAlpha } from "@/theme/color-alpha";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { CiBadge } from "./checks-parts";

const AVATAR_SIZE = 28;

/**
 * One pull request comment or review, as the desktop comment card: the author with the avatar,
 * the Bot and review badges, the time, the thread status and the file location. A tap opens or
 * closes the body: the code of the thread, the comment text, and the suggested changes.
 */
export const CiCommentCard = memo(function CiCommentCard({
  comment,
  open,
  now,
  onToggle,
  onOpenLink,
}: {
  comment: PullRequestReviewActivity;
  open: boolean;
  now: number;
  onToggle: (comment: PullRequestReviewActivity) => void;
  onOpenLink: (url: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const isReview = comment.source === "review";
  const outcome = isReview ? REVIEW_OUTCOME_PRESENTATION[comment.reviewOutcome] : null;
  const activityName = isReview ? "review" : "comment";
  const author = comment.author ?? "Unknown author";
  const timestamp = comment.createdAt ?? comment.updatedAt;
  const location = commentLocationLabel(comment);
  const url = comment.url;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Touchable
          feedback="highlight"
          onPress={() => onToggle(comment)}
          accessibilityRole="button"
          accessibilityLabel={`${open ? "Collapse" : "Expand"} ${activityName} from ${author}`}
          accessibilityState={{ expanded: open }}
          containerStyle={styles.grow}
          style={styles.headerButton}
        >
          <CommentAvatar url={comment.authorAvatarUrl} />
          <View style={styles.grow}>
            <View style={styles.authorLine}>
              <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.author}>
                {author}
              </Text>
              {isBotCommentAuthor(comment.author) ? (
                <CiBadge label="Bot" variant="secondary" small />
              ) : null}
              {outcome ? <CiBadge label={outcome.label} variant={outcome.variant} small /> : null}
              {timestamp ? (
                <Text variant="caption2" weight="regular" style={styles.muted}>
                  {formatCiRelativeTime(timestamp, now)}
                </Text>
              ) : null}
            </View>
            {comment.isResolved !== null || location ? (
              <ThreadLine resolved={comment.isResolved} location={location} />
            ) : null}
          </View>
          {/* A new key gives a recycled card a chevron without a turn animation. */}
          <CollapseChevron
            key={comment.id}
            collapsed={!open}
            colorValue={theme.desktop.mutedForeground}
          />
        </Touchable>
        {url ? (
          <IconButton
            icon="external-link"
            size={15}
            color="tertiaryLabel"
            accessibilityLabel={`Open ${activityName} from ${author}`}
            onPress={() => onOpenLink(url)}
          />
        ) : null}
      </View>
      {open ? <CommentBody comment={comment} /> : null}
    </View>
  );
});

/** The thread status and the file location of a review comment. */
function ThreadLine({
  resolved,
  location,
}: {
  resolved: boolean | null;
  location: string | null;
}): ReactElement {
  return (
    <View style={styles.threadLine}>
      {resolved !== null ? (
        <CiBadge
          label={resolved ? "Resolved" : "Unresolved"}
          variant={resolved ? "success" : "warning"}
          small
        />
      ) : null}
      {location ? (
        // The end of a path names the file, so a long path drops its start.
        <Text
          variant="monoSmall"
          numberOfLines={1}
          ellipsizeMode="head"
          style={[styles.grow, styles.muted]}
        >
          {location}
        </Text>
      ) : null}
    </View>
  );
}

/** The avatar of the author, or a comment mark when it has none or does not load. */
function CommentAvatar({ url }: { url: string | null }): ReactElement {
  const theme = useAppTheme();
  // The failure belongs to one address, so a recycled card loads the next avatar again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shown = url !== null && url !== failedUrl;
  return (
    <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
      {shown ? (
        <Image
          source={{ uri: url }}
          recyclingKey={url}
          cachePolicy="disk"
          style={styles.avatarImage}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Icon name="message-square" size={14} colorValue={theme.desktop.mutedForeground} />
      )}
    </View>
  );
}

function CommentBody({ comment }: { comment: PullRequestReviewActivity }): ReactElement {
  const theme = useAppTheme();
  const filePath = comment.path;
  const hasBody = comment.body.trim().length > 0;
  const patch = filePath !== null && comment.patch?.trim() ? comment.patch : null;
  const suggestions = filePath === null ? NO_PATCHES : comment.suggestionPatches;
  return (
    <>
      {patch !== null && filePath !== null ? (
        <View style={styles.patch}>
          <PatchLines patch={patch} filePath={filePath} />
        </View>
      ) : null}
      {hasBody ? (
        <View style={styles.body}>
          <MarkdownView
            markdown={comment.body}
            revision={`${comment.id}:${comment.updatedAt ?? ""}`}
            variant="compact"
            selectable
          />
        </View>
      ) : null}
      {comment.suggestionWarning ? (
        <View style={styles.warning} accessibilityRole="alert">
          <Icon name="circle-alert" size={16} colorValue={theme.desktop.warningMuted} />
          <Text variant="subhead" selectable style={styles.warningText}>
            {comment.suggestionWarning}
          </Text>
        </View>
      ) : null}
      {filePath !== null
        ? suggestions.map((suggestion, index) => (
            <SuggestedChange
              key={suggestion}
              patch={suggestion}
              filePath={filePath}
              position={index + 1}
              total={suggestions.length}
            />
          ))
        : null}
      {!hasBody && patch === null && suggestions.length === 0 && comment.source !== "review" ? (
        <Text variant="subhead" style={[styles.empty, styles.muted]}>
          No comment body.
        </Text>
      ) : null}
    </>
  );
}

const NO_PATCHES: readonly string[] = [];

/** The diff lines of a review thread or a suggestion. Hunks part with a thin gap, as on desktop. */
const PatchLines = memo(function PatchLines({
  patch,
  filePath,
}: {
  patch: string;
  filePath: string;
}): ReactElement {
  const rows = useMemo(() => buildFileDiffRows(patch, filePath), [filePath, patch]);
  if (rows === null) {
    return (
      <Text variant="monoSmall" selectable style={styles.rawPatch}>
        {patch}
      </Text>
    );
  }
  return (
    <>
      {rows.map((row) => {
        if (row.kind === "file") return null;
        if (row.kind === "hunk") {
          return row.hunkIndex > 0 ? <View key={row.key} style={styles.hunkGap} /> : null;
        }
        return <DiffRowView key={row.key} row={row} />;
      })}
    </>
  );
});

function SuggestedChange({
  patch,
  filePath,
  position,
  total,
}: {
  patch: string;
  filePath: string;
  position: number;
  total: number;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.suggestion} accessibilityLabel="Suggested change">
      <View style={styles.suggestionCard}>
        <View style={styles.suggestionHeader}>
          <Icon name="lightbulb" size={14} colorValue={theme.desktop.infoMuted} />
          <Text
            variant="caption1"
            weight="semibold"
            numberOfLines={1}
            style={styles.suggestionTitle}
          >
            Suggested change
          </Text>
          {total > 1 ? (
            <Text variant="caption2" weight="medium" style={styles.suggestionCount}>
              {`${position} of ${total}`}
            </Text>
          ) : null}
        </View>
        <PatchLines patch={patch} filePath={filePath} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grow: { flex: 1, minWidth: 0 },
  muted: { color: theme.desktop.mutedForeground },
  card: {
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.card,
  },
  header: { flexDirection: "row", alignItems: "center", paddingRight: theme.space.xs },
  headerButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: theme.space.md,
    paddingRight: theme.space.xs,
    paddingVertical: theme.space.sm,
  },
  authorLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  author: { flexShrink: 1, color: theme.desktop.foreground },
  threadLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, marginTop: 4 },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  avatarImage: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  patch: {
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
    backgroundColor: multiplyAlpha(theme.desktop.muted, 0.2),
  },
  rawPatch: { padding: theme.space.md, color: theme.desktop.foreground },
  hunkGap: { height: 4, backgroundColor: theme.desktop.muted },
  body: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.warningSurface,
  },
  warningText: { flex: 1, color: theme.desktop.warningSurfaceForeground },
  suggestion: {
    padding: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: multiplyAlpha(theme.desktop.infoBorder, 0.7),
    backgroundColor: multiplyAlpha(theme.desktop.infoSurface, 0.4),
  },
  suggestionCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.desktop.infoBorder,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.card,
  },
  suggestionHeader: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.infoBorder,
    backgroundColor: theme.desktop.infoSurface,
  },
  suggestionTitle: { flex: 1, color: theme.desktop.infoSurfaceForeground },
  suggestionCount: { color: theme.desktop.infoMuted },
  empty: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
}));
