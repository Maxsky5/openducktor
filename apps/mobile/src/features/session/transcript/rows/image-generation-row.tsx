import type {
  AgentGeneratedImageReadInput,
  AgentImageGenerationPart,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { runImagePreview } from "@openducktor/frontend-core/lib/image-preview-queue";
import {
  assertGeneratedImageReadMatches,
  createGeneratedImageBatcher,
  generatedImageReadIdentity,
} from "@openducktor/frontend-core/queries/agent-generated-image-batches";
import {
  type GeneratedImageMetadataInput,
  generatedImageMetadataQueryOptions,
} from "@openducktor/frontend-core/queries/agent-generated-image-metadata";
import {
  generatedImageAlt,
  IMAGE_GENERATION_INTERRUPTED_TEXT,
  imageGenerationFailureText,
  imageGenerationIncompleteText,
  imageGenerationStatusLabel,
  resolveGeneratedImagePreviewPlan,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-image-generation-model";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useActiveSession } from "@/host-session/active-session-context";
import { type Base64Resource, base64ResourceFileQueryOptions } from "@/platform/resource-files";
import { useResourceFiles } from "@/platform/resource-files-context";
import { ImagePlaceholder } from "@/rich-content/images/host-image";
import { ShareableImage } from "@/rich-content/images/shareable-image";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { monoWeight, SKELETON_PULSE, sansWeight } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { useRowVisible } from "../transcript-visibility";
import { type Disclosure, useDisclosure } from "./disclosure";
import { CopyControl, DisclosureMarker, Reveal } from "./row-parts";

// Reads of one session share host image batches, as on desktop.
const readInBatch = createGeneratedImageBatcher<Base64Resource>();

const formatResetTime = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleString();

/**
 * The desktop `AgentChatImageGeneration`: a card with a status header, then the progress
 * placeholder, the image with Share and Copy, or the failure, and the image details.
 */
export const ImageGenerationRow = memo(function ImageGenerationRow({
  part,
  rowKey,
}: {
  part: AgentImageGenerationPart;
  rowKey: string;
}): ReactElement {
  const reducedMotion = useReducedMotion();
  return (
    <View style={styles.card}>
      {/* Every state keeps its header, also while a completed image loads or fails. */}
      <ImageHeader label={imageGenerationStatusLabel(part)} running={part.status === "running"} />
      {part.status === "running" ? (
        <Animated.View style={[styles.generating, reducedMotion ? null : SKELETON_PULSE]} />
      ) : null}
      {part.status === "completed" ? <CompletedImage part={part} rowKey={rowKey} /> : null}
      {part.status === "failed" ? <ImageFailure failure={part.failure} /> : null}
      {part.status === "interrupted" ? (
        <Text style={styles.muted}>{IMAGE_GENERATION_INTERRUPTED_TEXT}</Text>
      ) : null}
      {part.status === "incomplete" ? (
        <Text style={styles.muted}>{imageGenerationIncompleteText(part)}</Text>
      ) : null}
      <ImageDetails part={part} rowKey={rowKey} />
    </View>
  );
});

/** The desktop `ImageGenerationHeader`: a spinner or an image icon and the status label. */
function ImageHeader({
  label,
  running = false,
}: {
  label: string;
  running?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.header} accessibilityRole="text" accessibilityLiveRegion="polite">
      {running ? (
        <LoaderSpinner size={16} color={theme.desktop.mutedForeground} />
      ) : (
        <Icon name="image" size={16} colorValue={theme.desktop.mutedForeground} />
      )}
      <Text style={styles.headerText}>{label}</Text>
    </View>
  );
}

/** The desktop `ImageFailure`: a destructive box with the reason and the next steps. */
function ImageFailure({ failure }: { failure: AgentImageGenerationPart["failure"] }): ReactElement {
  const theme = useAppTheme();
  const { message, nextSteps } = imageGenerationFailureText(failure, formatResetTime);
  return (
    <View style={styles.failure} accessibilityRole="alert">
      <Icon name="triangle-alert" size={16} colorValue={theme.desktop.destructive} />
      <View style={styles.failureText}>
        <Text selectable style={styles.text}>
          {message}
        </Text>
        {nextSteps.map((step) => (
          <Text key={step} style={styles.muted}>
            {step}
          </Text>
        ))}
      </View>
    </View>
  );
}

function CompletedImage({
  part,
  rowKey,
}: {
  part: AgentImageGenerationPart;
  rowKey: string;
}): ReactElement {
  const { sessionRef, supportsImageGeneration, visibleRows } = useTranscriptRows();
  const visible = useRowVisible(visibleRows, rowKey);
  const plan = resolveGeneratedImagePreviewPlan(part, sessionRef, supportsImageGeneration);
  const alt = generatedImageAlt(part);
  const imageKey = `generated-image:${rowKey}`;
  if (plan.kind === "unsupported" || plan.kind === "unavailable") {
    return <Text style={styles.muted}>{plan.message}</Text>;
  }
  // A few rows away from the viewport, the reads unmount, so their device files go away.
  if (!visible) return <ImagePlaceholder alt={alt} loading={false} recyclingKey={imageKey} />;
  if (plan.kind === "metadata") {
    const input: GeneratedImageMetadataInput = { ref: plan.ref, itemId: plan.itemId };
    if (plan.turnId !== undefined) input.turnId = plan.turnId;
    return <SavedImage input={input} alt={alt} imageKey={imageKey} />;
  }
  const input: AgentGeneratedImageReadInput = {
    ref: plan.ref,
    itemId: plan.itemId,
    revision: plan.revision,
  };
  if (plan.turnId !== undefined) input.turnId = plan.turnId;
  return <LoadedImage input={input} alt={alt} imageKey={imageKey} enabled />;
}

/** The runtime saved the image file. Its metadata names the revision to read. */
function SavedImage({
  input,
  alt,
  imageKey,
}: {
  input: GeneratedImageMetadataInput;
  alt: string;
  imageKey: string;
}): ReactElement {
  const operations = useAgentOperationsContext();
  const metadata = useQuery(generatedImageMetadataQueryOptions(input, operations));
  if (metadata.error) return <ImageError message={metadata.error.message} />;
  if (!metadata.data) return <ImagePlaceholder alt={alt} loading recyclingKey={imageKey} />;
  return (
    <LoadedImage
      key={metadata.data.revision}
      input={{ ...input, revision: metadata.data.revision }}
      alt={alt}
      imageKey={imageKey}
      enabled={!metadata.isStale}
    />
  );
}

/**
 * The image bytes go from the host to a device cache file and leave JavaScript memory. The view
 * mounts only while its row is within a few rows of the viewport. The file goes away when it
 * unmounts, because the read has no cache time. `enabled` is false while the image metadata
 * reads again.
 */
function LoadedImage({
  input,
  alt,
  imageKey,
  enabled,
}: {
  input: AgentGeneratedImageReadInput;
  alt: string;
  imageKey: string;
  enabled: boolean;
}): ReactElement {
  const operations = useAgentOperationsContext();
  const { remote } = useActiveSession().remote;
  const files = useResourceFiles();
  // The first connection generation keys the read, so a reconnect does not read it again.
  const [generation] = useState(() => remote.readState().generation);
  const options = useMemo(
    () =>
      base64ResourceFileQueryOptions(
        files,
        ["generated-image", ...generatedImageReadIdentity(input).map((part) => part ?? "")],
        generation,
        (signal) =>
          readInBatch(operations, input, signal, (request) =>
            runImagePreview(signal, async (): Promise<Base64Resource> => {
              const result = await operations.readGeneratedImage(request);
              signal.throwIfAborted();
              assertGeneratedImageReadMatches(result, request);
              return { base64: result.base64, mediaType: result.mime };
            }),
          ),
      ),
    [files, generation, input, operations],
  );
  const query = useQuery({ ...options, enabled });
  if (query.isError) return <ImageError message={errorMessage(query.error)} />;
  if (!query.data) return <ImagePlaceholder alt={alt} loading recyclingKey={imageKey} />;
  return (
    <View style={styles.image}>
      <ShareableImage
        uri={query.data.uri}
        recyclingKey={imageKey}
        alt={alt}
        mediaType={query.data.mediaType}
      />
    </View>
  );
}

function ImageError({ message }: { message: string }): ReactElement {
  return (
    <Text accessibilityRole="alert" selectable style={styles.error}>
      {message}
    </Text>
  );
}

/**
 * The desktop image details: an "Image details" control that opens the saved file with a copy
 * action, the background, and "View prompt" with the generation prompt.
 */
function ImageDetails({
  part,
  rowKey,
}: {
  part: AgentImageGenerationPart;
  rowKey: string;
}): ReactElement | null {
  const theme = useAppTheme();
  const details = useDisclosure(false, `${rowKey}:image-details`);
  const prompt = useDisclosure(false, `${rowKey}:image-prompt`);
  if (
    !part.revisedPrompt &&
    part.savedPath === undefined &&
    part.transparentBackground === undefined
  )
    return null;
  const muted = theme.desktop.mutedForeground;
  return (
    <View>
      <GhostToggle label="Image details" disclosure={details} />
      {details.open ? (
        <Reveal animate={details.pressed} style={styles.details}>
          {part.savedPath !== undefined ? (
            <View style={styles.detail}>
              <Text style={styles.detailLabel}>Saved file</Text>
              <View style={styles.pathLine}>
                <Text selectable style={styles.path}>
                  {part.savedPath}
                </Text>
                <CopyControl
                  text={part.savedPath}
                  what="Path"
                  accessibilityLabel="Copy generated image path"
                  color={muted}
                />
              </View>
            </View>
          ) : null}
          {part.transparentBackground !== undefined ? (
            <View style={styles.background}>
              <Text style={styles.detailLabel}>Background</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {part.transparentBackground ? "Transparent" : "Opaque"}
                </Text>
              </View>
            </View>
          ) : null}
          {part.revisedPrompt ? (
            <View>
              <GhostToggle label="View prompt" icon="text-align-start" disclosure={prompt} />
              {prompt.open ? (
                <Reveal animate={prompt.pressed} style={styles.prompt}>
                  <Text style={styles.detailLabel}>Generation prompt</Text>
                  <Text selectable style={styles.text}>
                    {part.revisedPrompt}
                  </Text>
                </Reveal>
              ) : null}
            </View>
          ) : null}
        </Reveal>
      ) : null}
    </View>
  );
}

/** The desktop ghost toggle button: muted text, an optional icon, and a chevron at the end. */
function GhostToggle({
  label,
  icon,
  disclosure,
}: {
  label: string;
  icon?: IconName | undefined;
  disclosure: Disclosure;
}): ReactElement {
  const theme = useAppTheme();
  const muted = theme.desktop.mutedForeground;
  return (
    <Touchable
      feedback="highlight"
      radius={theme.radius.md}
      onPress={disclosure.toggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: disclosure.open }}
      style={styles.toggle}
    >
      {icon ? <Icon name={icon} size={16} colorValue={muted} /> : null}
      <Text style={styles.toggleText}>{label}</Text>
      <DisclosureMarker
        open={disclosure.open}
        animated={disclosure.pressed}
        color={muted}
        size={14}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop card: `my-2 flex flex-col gap-3 rounded-xl border border-border bg-card p-3
  // shadow-sm`.
  card: {
    marginVertical: theme.space.sm,
    padding: theme.space.md,
    gap: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  header: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 32 },
  headerText: {
    ...sansWeight("medium"),
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
  // The desktop running placeholder: `aspect-[4/3] max-h-64 rounded-lg` on the muted color.
  generating: {
    aspectRatio: 4 / 3,
    maxHeight: 256,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.muted,
  },
  text: { ...sansWeight("regular"), fontSize: 14, lineHeight: 22, color: theme.desktop.foreground },
  muted: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.mutedForeground,
  },
  error: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.destructive,
  },
  // The desktop failure box: `rounded-lg border border-destructive/20 bg-destructive/5 p-3`.
  failure: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: withAlpha(theme.desktop.destructive, 0.2),
    backgroundColor: withAlpha(theme.desktop.destructive, 0.05),
  },
  failureText: { flex: 1, minWidth: 0, gap: theme.space.sm },
  image: { gap: theme.space.md },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 36,
    paddingHorizontal: theme.space.md,
  },
  toggleText: {
    ...sansWeight("medium"),
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: theme.desktop.mutedForeground,
  },
  details: { gap: theme.space.md, paddingTop: theme.space.md },
  detail: { gap: theme.space.xs },
  detailLabel: {
    ...sansWeight("medium"),
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.desktop.mutedForeground,
  },
  pathLine: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  path: {
    ...monoWeight("regular"),
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    color: theme.desktop.mutedForeground,
  },
  background: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  // The desktop secondary badge: `rounded-full px-2.5 py-0.5 text-xs font-medium bg-secondary`.
  badge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
    backgroundColor: theme.desktop.secondary,
  },
  badgeText: {
    ...sansWeight("medium"),
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.desktop.secondaryForeground,
  },
  // The desktop prompt box: `mt-2 flex flex-col gap-2 rounded-lg bg-muted/50 p-3`.
  prompt: {
    marginTop: theme.space.sm,
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.colors.nestedFill,
  },
}));
