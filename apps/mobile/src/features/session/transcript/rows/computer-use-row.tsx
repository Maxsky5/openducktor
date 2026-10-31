import {
  buildComputerUsePresentation,
  computerUseScreenshotLabel,
  computerUseScreenshotUri,
  readToolTiming,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { useToolPartDetails } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { useRecyclingState } from "@shopify/flash-list";
import { Image } from "expo-image";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { useRowVisible } from "../transcript-visibility";
import { useDisclosure } from "./disclosure";
import { DisclosureMarker, PreText, Reveal, ToolTiming } from "./row-parts";
import { ReadFullDetails } from "./tool-details";

/**
 * The desktop `ComputerUseToolMessage`: a card with the pointer icon, "Computer Use", the
 * action, the screenshot pill, and the timing. A press on the card opens the JavaScript, Error,
 * and Output sections. The screenshot pill shows the screenshots under the card, where the
 * desktop opens a preview dialog.
 */
export const ComputerUseRow = memo(function ComputerUseRow({
  meta,
  messageTimestamp,
  timeLabel,
  rowKey,
}: {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  rowKey: string;
}): ReactElement {
  const theme = useAppTheme();
  const { desktop } = theme;
  const presentation = useMemo(() => buildComputerUsePresentation(meta), [meta]);
  const { actionTitle, isFailed, hasDetails, screenshots } = presentation;
  const disclosure = useDisclosure(false, rowKey);
  const [screenshotsOpen, setScreenshotsOpen] = useRecyclingState(false, [rowKey]);
  const toggleScreenshots = useCallback(
    () => setScreenshotsOpen((open) => !open),
    [setScreenshotsOpen],
  );
  const timing = readToolTiming(meta, messageTimestamp);
  const screenshotLabel = computerUseScreenshotLabel(screenshots.length);
  styles.useVariants({ failed: isFailed });
  const summary = (
    <>
      <View style={styles.titleLine}>
        <Icon
          name="mouse-pointer-click"
          size={16}
          colorValue={isFailed ? desktop.destructiveAccent : desktop.mutedForeground}
        />
        <Text style={styles.kind}>Computer Use</Text>
        <ToolTiming active={timing.isActive} durationMs={timing.durationMs} timeLabel={timeLabel} />
        {hasDetails ? (
          <DisclosureMarker
            open={disclosure.open}
            animated={disclosure.pressed}
            color={desktop.mutedForeground}
            size={14}
          />
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.action}>
        {actionTitle}
      </Text>
    </>
  );
  const label = `Computer Use: ${actionTitle}${screenshotLabel ? `, ${screenshotLabel}` : ""}${isFailed ? ", failed" : ""}`;
  return (
    <View style={styles.card}>
      {hasDetails ? (
        <Touchable
          feedback="highlight"
          radius={theme.radius.sm}
          onPress={disclosure.toggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={disclosure.open ? "Hides the details." : "Shows the details."}
          accessibilityState={{ expanded: disclosure.open, busy: timing.isActive }}
          style={styles.summary}
        >
          {summary}
        </Touchable>
      ) : (
        <View style={styles.summary} accessible accessibilityLabel={label}>
          {summary}
        </View>
      )}
      {screenshotLabel ? (
        <Touchable
          feedback="scale"
          radius={theme.radius.pill}
          onPress={toggleScreenshots}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={screenshotLabel}
          accessibilityState={{ expanded: screenshotsOpen }}
          style={styles.pill}
        >
          <Icon name="image" size={12} colorValue={desktop.foreground} />
          <Text style={styles.pillText}>{screenshotLabel}</Text>
        </Touchable>
      ) : null}
      {hasDetails && disclosure.open ? (
        <Reveal animate={disclosure.pressed} style={styles.details}>
          <ComputerUseSections meta={meta} />
        </Reveal>
      ) : null}
      {screenshotsOpen
        ? screenshots.map((image, index) => (
            <Screenshot
              // Screenshots keep their order in the call, so the index names each one.
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              key={index}
              uri={computerUseScreenshotUri(image)}
              index={index}
              rowKey={rowKey}
            />
          ))
        : null}
    </View>
  );
});

/**
 * The JavaScript, Error, and Output sections of a call that has them. When compact history cut
 * the output, the sections read the full call from the host.
 */
function ComputerUseSections({ meta }: { meta: ToolMeta }): ReactElement {
  return meta.detailsOmitted ? <CutComputerUseSections meta={meta} /> : <Sections meta={meta} />;
}

function CutComputerUseSections({ meta: rowMeta }: { meta: ToolMeta }): ReactElement {
  const { desktop } = useAppTheme();
  const { meta } = useToolPartDetails(rowMeta, false);
  const cut = meta.detailsOmitted === true;
  return (
    <>
      <Sections meta={meta} withOutput={!cut} />
      {cut ? <ReadFullDetails meta={meta} color={desktop.foreground} /> : null}
    </>
  );
}

function Sections({
  meta,
  withOutput = true,
}: {
  meta: ToolMeta;
  withOutput?: boolean;
}): ReactElement {
  const { code, errorText, outputText } = useMemo(() => buildComputerUsePresentation(meta), [meta]);
  return (
    <>
      {code.length > 0 ? <Section label="JavaScript" text={code} /> : null}
      {errorText.length > 0 ? <Section label="Error" text={errorText} error /> : null}
      {withOutput && outputText.length > 0 ? <Section label="Output" text={outputText} /> : null}
    </>
  );
}

/** The desktop `ComputerUseSection`: a `rounded border` box with a label and pre text. */
function Section({
  label,
  text,
  error = false,
}: {
  label: string;
  text: string;
  error?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const color = error ? theme.desktop.destructiveSurfaceForeground : theme.desktop.foreground;
  styles.useVariants({ section: error ? "error" : "plain" });
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color }]}>{label}</Text>
      <View style={styles.sectionBody}>
        <PreText text={text} color={color} />
      </View>
    </View>
  );
}

function Screenshot({
  uri,
  index,
  rowKey,
}: {
  uri: string;
  index: number;
  rowKey: string;
}): ReactElement {
  const { visibleRows } = useTranscriptRows();
  const visible = useRowVisible(visibleRows, rowKey);
  const source = useMemo(() => ({ uri }), [uri]);
  // The failure belongs to one image, so it resets when the screenshot changes.
  const [failed, setFailed] = useRecyclingState(false, [uri]);
  return (
    <View style={[styles.screenshot, failed ? styles.unavailable : null]}>
      {failed ? (
        <Text variant="footnote" style={styles.unavailableText}>
          {`Screenshot ${index + 1} is unavailable.`}
        </Text>
      ) : visible ? (
        <Image
          source={source}
          recyclingKey={`${rowKey}:${index}`}
          contentFit="contain"
          cachePolicy="none"
          accessibilityLabel={`Computer Use screenshot ${index + 1}`}
          onError={() => setFailed(true)}
          style={styles.image}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop card: `my-2 rounded-lg border px-3 py-2 shadow-sm`, destructive when it failed.
  card: {
    marginVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    gap: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    boxShadow: theme.shadows.card,
    variants: {
      failed: {
        true: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
        false: {
          borderColor: theme.desktop.border,
          backgroundColor: theme.desktop.card,
        },
      },
    },
  },
  summary: { gap: 2 },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 22,
  },
  kind: {
    ...sansWeight("semibold"),
    fontSize: 11.5,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: theme.desktop.mutedForeground,
  },
  action: {
    ...sansWeight("medium"),
    fontSize: 15,
    lineHeight: 20,
    variants: {
      failed: {
        true: { color: theme.desktop.destructiveSurfaceForeground },
        false: { color: theme.desktop.foreground },
      },
    },
  },
  // The desktop pill: `rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px]`.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.chipFill,
  },
  pillText: {
    ...sansWeight("medium"),
    fontSize: 11.5,
    lineHeight: 16,
    color: theme.desktop.foreground,
  },
  details: { gap: theme.space.sm },
  section: {
    borderWidth: 1,
    borderRadius: 4,
    variants: {
      section: {
        plain: {
          borderColor: theme.desktop.border,
          backgroundColor: theme.colors.nestedFill,
        },
        error: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
      },
    },
  },
  sectionLabel: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  sectionBody: {
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.sm,
  },
  screenshot: {
    aspectRatio: 16 / 10,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.muted,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  unavailable: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.md,
  },
  unavailableText: {
    textAlign: "center",
    color: theme.desktop.mutedForeground,
  },
}));
