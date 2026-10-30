import { useRecyclingState } from "@shopify/flash-list";
import type { AgentNativeFileReference, AgentToolResultContent } from "@openducktor/contracts";
import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import {
  buildQuestionDetailEntries,
  FILE_DIFF_UNAVAILABLE_MESSAGE,
  formatToolInput,
  NO_ANSWER_YET_LABEL,
  readToolFileEdits,
  toolResultContentEntries,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { useToolPartDetails } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { memo, type ReactElement, useMemo } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore } from "@/app-shell/app-services";
import { readDataUri } from "@/platform/data-uri";
import { useResourceFiles } from "@/platform/resource-files-context";
import { shareDeviceFile } from "@/rich-content/images/use-image-actions";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { FileEditView } from "./file-edit-view";
import { DetailsBox, LINE_DETAILS_INSET, PreText } from "./row-parts";

/**
 * The colors of tool detail boxes. `card` is the desktop `rounded border border-border bg-card`
 * of a regular call. `current` is the workflow card box: a border in the text color at 20% on
 * the card.
 */
export type ToolDetailsColors = {
  frame: StyleProp<ViewStyle>;
  text: string;
  errorFrame: StyleProp<ViewStyle>;
  errorText: string;
};

export const useCardDetailsColors = (): ToolDetailsColors => {
  const theme = useAppTheme();
  // The parts of the theme stay the same objects until the theme changes, so the memo keys on them.
  return useMemo(
    () => ({
      frame: {
        borderColor: theme.desktop.border,
        backgroundColor: theme.desktop.card,
      },
      text: theme.desktop.foreground,
      errorFrame: {
        borderColor: theme.desktop.destructiveBorder,
        backgroundColor: theme.desktop.destructiveSurface,
      },
      errorText: theme.desktop.destructiveMuted,
    }),
    [theme.desktop],
  );
};

/**
 * Returns a reader that formats the text on its first call and keeps the result. A closed box
 * never calls it, so it does no format work.
 */
const formatOnce = (format: () => string): (() => string) => {
  let text: string | undefined;
  return () => {
    text ??= format();
    return text;
  };
};

/** Tool text that a box formats when it opens. */
function FormattedText({ read, color }: { read: () => string; color: string }): ReactElement {
  return <PreText text={read()} color={color} />;
}

type ToolDetailsProps = {
  meta: ToolMeta;
  resetKey: string;
  hasInput: boolean;
  hasOutput: boolean;
  hasError: boolean;
  colors: ToolDetailsColors;
  errorOpen?: boolean;
};

/**
 * The desktop Input, Output, and Error boxes of a Tool Call. Each box opens on its own, and its
 * text builds only when it opens. The Error box opens at first when `errorOpen` is true. Compact
 * history cuts long details: an open box reads the full call from the host, and every box then
 * shows it. The error is never cut.
 */
export const ToolDetails = memo(function ToolDetails(props: ToolDetailsProps): ReactElement {
  return props.meta.detailsOmitted ? <CutToolDetails {...props} /> : <ToolDetailBoxes {...props} />;
});

/** The boxes of a call that compact history cut. They show the full call once a box reads it. */
function CutToolDetails({ meta, ...props }: ToolDetailsProps): ReactElement {
  return <ToolDetailBoxes {...props} meta={useToolPartDetails(meta, false).meta} />;
}

function ToolDetailBoxes({
  meta,
  resetKey,
  hasInput,
  hasOutput,
  hasError,
  colors,
  errorOpen = false,
}: ToolDetailsProps): ReactElement {
  const cut = meta.detailsOmitted === true;
  const output = useMemo(
    () => formatOnce(() => formatRawJsonLikeText(meta.output ?? "")),
    [meta.output],
  );
  const error = useMemo(
    () => formatOnce(() => formatRawJsonLikeText(meta.error ?? "")),
    [meta.error],
  );
  return (
    <>
      {hasInput && meta.input ? (
        <ToolInput meta={meta} resetKey={resetKey} colors={colors} />
      ) : null}
      {hasOutput ? (
        <DetailsBox
          label="Output"
          resetKey={`${resetKey}:output`}
          frameStyle={colors.frame}
          textColor={colors.text}
          copyText={cut || meta.resultContent ? undefined : output}
        >
          {cut ? (
            <ReadFullDetails meta={meta} color={colors.text} />
          ) : (
            <ToolOutput content={meta.resultContent} output={output} color={colors.text} />
          )}
        </DetailsBox>
      ) : null}
      {hasError && meta.error ? (
        <DetailsBox
          label="Error"
          resetKey={`${resetKey}:error`}
          defaultOpen={errorOpen}
          frameStyle={colors.errorFrame}
          textColor={colors.errorText}
          copyText={error}
        >
          <FormattedText read={error} color={colors.errorText} />
        </DetailsBox>
      ) : null}
    </>
  );
}

function ToolInput({
  meta,
  resetKey,
  colors,
}: {
  meta: ToolMeta;
  resetKey: string;
  colors: ToolDetailsColors;
}): ReactElement {
  const { workingDirectory } = useTranscriptRows();
  const cut = meta.detailsOmitted === true;
  // The box builds its content only while open, so the format runs on the first open.
  const text = useMemo(
    () => formatOnce(() => (meta.input ? formatToolInput(meta.input, workingDirectory) : "")),
    [meta.input, workingDirectory],
  );
  return (
    <DetailsBox
      label="Input"
      resetKey={`${resetKey}:input`}
      frameStyle={colors.frame}
      textColor={colors.text}
      copyText={cut ? undefined : text}
    >
      {cut ? (
        <ReadFullDetails meta={meta} color={colors.text} />
      ) : (
        <FormattedText read={text} color={colors.text} />
      )}
    </DetailsBox>
  );
}

/**
 * Reads the full details of a call that compact history cut, while its box shows. The boxes of
 * the call show the full details when the read ends.
 */
export function ReadFullDetails({ meta, color }: { meta: ToolMeta; color: string }): ReactElement {
  const { error, retry } = useToolPartDetails(meta, true);
  if (error === null)
    return (
      <View style={styles.reading} accessible accessibilityLabel="Loading the full details">
        <LoaderSpinner size={12} color={color} />
        <Text style={[styles.fileText, { color }]}>Loading the full details</Text>
      </View>
    );
  return (
    <View style={styles.file}>
      <Text selectable style={[styles.fileText, { color }]}>
        {error}
      </Text>
      <Touchable
        feedback="opacity"
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Retry loading the full details"
        style={styles.download}
      >
        <Text style={[styles.fileText, styles.downloadText, { color }]}>Retry</Text>
      </Touchable>
    </View>
  );
}

/**
 * The desktop `AgentToolResultContentView`: text as pre text, files as native file lines.
 * `output` reads the formatted output text, for a call without result content.
 */
function ToolOutput({
  content,
  output,
  color,
}: {
  content: AgentToolResultContent[] | undefined;
  output: () => string;
  color: string;
}): ReactElement {
  const entries = useMemo(() => (content ? toolResultContentEntries(content) : null), [content]);
  if (!entries) return <FormattedText read={output} color={color} />;
  return (
    <>
      {entries.map(({ value, key }) =>
        value.kind === "text" ? (
          <PreText key={key} text={value.text} color={color} />
        ) : (
          <NativeFileReference key={key} file={value.file} color={color} />
        ),
      )}
    </>
  );
}

/** The desktop `AgentNativeFileReferenceView`: the file name and type, its URI, and why it is missing. */
function NativeFileReference({
  file,
  color,
}: {
  file: AgentNativeFileReference;
  color: string;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.file}>
      <Text selectable style={[styles.fileText, { color }]}>
        {`${file.name ?? "Native file"}${file.mime ? ` (${file.mime})` : ""}`}
      </Text>
      {file.uri ? (
        <Text selectable style={[styles.fileUri, { color: theme.desktop.mutedForeground }]}>
          {file.uri}
        </Text>
      ) : null}
      {file.downloadUri ? (
        <DownloadAttachment
          downloadUri={file.downloadUri}
          name={file.name ?? "attachment"}
          color={color}
        />
      ) : null}
      {file.unavailableReason ? (
        <Text style={[styles.fileText, { color: theme.desktop.mutedForeground }]}>
          {file.unavailableReason}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The desktop "Download attachment" link of a native file. The phone writes the file to the
 * device cache and opens the share sheet, which saves or sends it.
 */
function DownloadAttachment({
  downloadUri,
  name,
  color,
}: {
  downloadUri: string;
  name: string;
  color: string;
}): ReactElement {
  const files = useResourceFiles();
  const { feedback } = useFeedbackStore();
  // The list reuses the view of a row for other rows, so the flag resets for another file.
  const [busy, setBusy] = useRecyclingState(false, [downloadUri]);
  const download = async (): Promise<void> => {
    const content = readDataUri(downloadUri);
    if (!content) {
      feedback.show("error", "The attachment cannot be read.", {
        description: "Its data URI is not valid.",
      });
      return;
    }
    setBusy(true);
    try {
      const saved = await ("base64" in content
        ? files.writeBase64({
            base64: content.base64,
            mediaType: content.mediaType,
          })
        : files.write(new TextEncoder().encode(content.text), content.mediaType));
      if (!(await shareDeviceFile(saved.uri, name, content.mediaType))) {
        feedback.show("warning", "Sharing is not available on this device.");
      }
    } catch (cause) {
      feedback.show("error", "The attachment was not saved.", {
        description: errorMessage(cause),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Touchable
      feedback="opacity"
      disabled={busy}
      onPress={() => void download()}
      accessibilityRole="button"
      accessibilityLabel={`Download attachment ${name}`}
      accessibilityHint="Opens the share sheet to save the file."
      accessibilityState={{ busy }}
      style={styles.download}
    >
      <Text style={[styles.fileText, styles.downloadText, { color }]}>Download attachment</Text>
      {busy ? <LoaderSpinner size={12} color={color} /> : null}
    </Touchable>
  );
}

/**
 * The desktop questions box of a question tool: `ml-5 rounded border bg-muted/90`, with each
 * prompt in medium text and its answers, or "No answer yet" in muted italic text.
 */
export const QuestionDetails = memo(function QuestionDetails({
  meta,
  resetKey,
}: {
  meta: ToolMeta;
  resetKey: string;
}): ReactElement | null {
  const theme = useAppTheme();
  const entries = useMemo(() => buildQuestionDetailEntries(meta), [meta]);
  if (entries.length === 0) return null;
  return (
    <View style={styles.questions}>
      <DetailsBox
        label="Questions and answers"
        resetKey={`${resetKey}:questions`}
        frameStyle={styles.questionsFrame}
        textColor={theme.desktop.foreground}
        divided
      >
        {entries.map(({ key, detail }) => (
          <View key={key} style={styles.question}>
            <Text selectable style={styles.prompt}>
              {detail.prompt}
            </Text>
            <Text selectable style={detail.answers.length > 0 ? styles.answer : styles.noAnswer}>
              {detail.answers.length > 0 ? detail.answers.join(", ") : NO_ANSWER_YET_LABEL}
            </Text>
          </View>
        ))}
      </DetailsBox>
    </View>
  );
});

/** The files that a file edit call changed, each as a desktop file edit card. */
export const ToolFileEdits = memo(function ToolFileEdits({
  meta,
  resetKey,
}: {
  meta: ToolMeta;
  resetKey: string;
}): ReactElement | null {
  const { workingDirectory, expandFileDiffsByDefault } = useTranscriptRows();
  const { edits, diffUnavailable } = useMemo(
    () => readToolFileEdits(meta, workingDirectory),
    [meta, workingDirectory],
  );
  if (edits.length === 0 && !diffUnavailable) return null;
  return (
    <>
      {edits.map((data) => (
        <FileEditView
          key={data.filePath}
          data={data}
          resetKey={resetKey}
          defaultOpen={expandFileDiffsByDefault}
        />
      ))}
      {diffUnavailable ? (
        <Text style={styles.unavailable}>{FILE_DIFF_UNAVAILABLE_MESSAGE}</Text>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  file: { gap: theme.space.xs },
  fileText: { ...sansWeight("regular"), fontSize: 13, lineHeight: 18 },
  fileUri: { ...monoWeight("regular"), fontSize: 12, lineHeight: 17 },
  download: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  reading: { flexDirection: "row", alignItems: "center", gap: 6 },
  downloadText: { textDecorationLine: "underline" },
  questions: { paddingLeft: LINE_DETAILS_INSET, paddingRight: theme.space.xs },
  questionsFrame: {
    borderColor: theme.desktop.border,
    backgroundColor: withAlpha(theme.desktop.muted, 0.9),
  },
  question: { gap: 2 },
  prompt: {
    ...sansWeight("medium"),
    fontSize: 13,
    lineHeight: 18,
    color: theme.desktop.foreground,
  },
  answer: {
    ...sansWeight("regular"),
    fontSize: 13,
    lineHeight: 18,
    color: theme.desktop.foreground,
  },
  noAnswer: {
    ...sansWeight("regular"),
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    color: theme.desktop.mutedForeground,
  },
  unavailable: {
    marginHorizontal: theme.space.xs,
    ...sansWeight("regular"),
    fontSize: 12,
    lineHeight: 16,
    color: theme.desktop.mutedForeground,
  },
}));
