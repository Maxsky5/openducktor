import {
  type ComponentRef,
  memo,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  Text,
  TextInput,
  type TextLayoutEvent,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { referenceChipColors, referenceChipIcon } from "@/features/session/reference-chip-paint";
import { useAppTheme } from "@/theme/app-theme-context";
import { focusWithKeyboard } from "@/ui/focus-with-keyboard";
import { sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import {
  CHIP_MARGIN_END,
  CHIP_MARGIN_START,
  CHIP_PAD,
  type ComposerLayout,
  type ComposerSpan,
} from "./composer-text";
import type { ComposerSelectionRequest } from "./use-composer-draft-editor";

export type ComposerTextFieldProps = {
  layout: ComposerLayout;
  editable: boolean;
  placeholder: string;
  accessibilityLabel: string;
  /** What a screen reader reads after the label: the placeholder when omitted, nothing for null. */
  accessibilityHint?: string | null | undefined;
  /** The shortest the field is, 44 by default. */
  minHeight?: number | undefined;
  /** The tallest the field grows before it scrolls. */
  maxHeight: number;
  selectionRequest: ComposerSelectionRequest | null;
  onChangeText: (text: string) => void;
  onSelectionChange: (start: number, end: number) => void;
  onFocusChange: (focused: boolean) => void;
  /** Focuses the field and opens the keyboard when it mounts. */
  autoFocus?: boolean | undefined;
};

/** The input on the UI thread, so its scroll offset moves the chip pills in the same frame. */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type ChipSpan = Extract<ComposerSpan, { kind: "chip" }>;
type TextLayoutLine = TextLayoutEvent["nativeEvent"]["lines"][number];

/**
 * The desktop chip: a capsule 24 high with a 1-point border, 10 points of padding, and a 14-point
 * icon before a 12-point medium label.
 */
const PILL_HEIGHT = 24;
const PILL_PADDING = 10;
const PILL_ICON_SIZE = 14;
const INPUT_FONT_SIZE = 16;
const INPUT_PADDING_VERTICAL = 10;
/** The start margin is a no-break space, 0.255 em wide: 2 points, as the desktop `mx-0.5`. */
const MARGIN_START_FONT_SIZE = 8;
/** How far above the baseline the middle of the 12-point label is: half its cap height. */
const LABEL_MIDDLE_ABOVE_BASELINE = 4.5;

/**
 * The editable draft as one native multiline input, as the desktop editor: text and chips flow on
 * the same lines, and a line break after a chip starts a line below it. Each chip is its label in
 * the input, between glued spacing characters, and the field draws the desktop pill under it.
 * Backspace after a chip removes the whole chip.
 */
export function ComposerTextField({
  layout,
  editable,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
  minHeight = 44,
  maxHeight,
  selectionRequest,
  onChangeText,
  onSelectionChange,
  onFocusChange,
  autoFocus = false,
}: ComposerTextFieldProps): ReactElement {
  const theme = useAppTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (autoFocus) focusWithKeyboard(input.current);
  }, [autoFocus]);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const hasChips = layout.spans.some((span) => span.kind === "chip" && span.text.length > 0);
  const empty = layout.text.length === 0;
  const placeholderHeight = usePlaceholderHeight(empty);
  // An empty field is at least as tall as its placeholder (see `PlaceholderCopy`).
  const fieldMinHeight =
    placeholderHeight.value === null
      ? minHeight
      : Math.min(
          maxHeight,
          Math.max(minHeight, placeholderHeight.value + 2 * INPUT_PADDING_VERTICAL),
        );

  // A chip edit or a replaced draft changes the text, so the caret goes where the edit names.
  useEffect(() => {
    if (!selectionRequest) return;
    input.current?.setSelection(selectionRequest.position, selectionRequest.position);
  }, [selectionRequest]);

  return (
    <View>
      {hasChips ? <ChipPills layout={layout} scrollY={scrollY} /> : null}
      {placeholderHeight.measure ? (
        <PlaceholderCopy placeholder={placeholder} onHeight={placeholderHeight.set} />
      ) : null}
      <AnimatedTextInput
        ref={input}
        editable={editable}
        multiline
        submitBehavior="newline"
        textAlignVertical="top"
        // The pill copies break lines the same way, so each pill stays on its chip.
        textBreakStrategy="simple"
        autoCorrect
        placeholder={placeholder}
        placeholderTextColor={theme.desktop.mutedForeground}
        selectionColor={theme.colors.selection}
        selectionHandleColor={theme.colors.tint}
        cursorColor={theme.colors.tint}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={
          accessibilityHint === undefined ? placeholder : (accessibilityHint ?? undefined)
        }
        style={[styles.input, styles.text, { minHeight: fieldMinHeight, maxHeight }]}
        onChangeText={onChangeText}
        onSelectionChange={(event) => {
          const { start, end } = event.nativeEvent.selection;
          onSelectionChange(start, end);
        }}
        onScroll={onScroll}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      >
        {/* An empty input has no children, so it sizes to its placeholder. */}
        {empty ? null : <DraftText spans={layout.spans} visible />}
      </AnimatedTextInput>
    </View>
  );
}

/**
 * The height of the placeholder text while the field is empty on Android, or null. After the user
 * deletes the whole draft, the Android input keeps measuring the text that it had, so it can stay
 * one line high and cut a placeholder of two lines. iOS measures the placeholder itself.
 */
const usePlaceholderHeight = (empty: boolean) => {
  const [height, setHeight] = useState<number | null>(null);
  const measure = empty && Platform.OS === "android";
  return { measure, value: measure ? height : null, set: setHeight };
};

/** A copy of the placeholder that draws nothing and reports the height of its lines. */
function PlaceholderCopy({
  placeholder,
  onHeight,
}: {
  placeholder: string;
  onHeight: (height: number) => void;
}): ReactElement {
  return (
    <Text
      style={[styles.text, styles.copy, styles.copyWidth]}
      textBreakStrategy="simple"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {placeholder}
    </Text>
  );
}

/** The text runs and chips of a draft. A copy for measuring draws its chips with no color. */
function DraftText({ spans, visible }: { spans: ComposerSpan[]; visible: boolean }): ReactElement {
  return (
    <>
      {spans.map((span) => {
        if (span.text.length === 0) return null;
        if (span.kind === "text") return <Text key={span.segmentId}>{span.text}</Text>;
        return (
          <Text key={span.segmentId}>
            <Text style={styles.marginStart}>{CHIP_MARGIN_START}</Text>
            <ChipLabel span={span} visible={visible} />
            {CHIP_MARGIN_END}
          </Text>
        );
      })}
    </>
  );
}

/** The part of a chip that the pill covers: the pads and the label in the 12-point chip font. */
function ChipLabel({ span, visible }: { span: ChipSpan; visible: boolean }): ReactElement {
  const theme = useAppTheme();
  const color = visible ? referenceChipColors(theme, span.chip).color : undefined;
  return (
    <Text>
      {span.padStart}
      <Text style={[styles.chipText, color === undefined ? null : { color }]}>{span.label}</Text>
      {CHIP_PAD}
    </Text>
  );
}

/**
 * The pills under the input. The pill of a chip ends where a copy of the input text up to the
 * end of the chip ends, on the last line of that copy, and it is as wide as the chip alone. A chip
 * never breaks across lines, and the copies break lines as the input does, so each pill covers the
 * chip text of the input. The pills follow the scroll of the input on the UI thread, so a scroll
 * renders nothing.
 */
function ChipPills({
  layout,
  scrollY,
}: {
  layout: ComposerLayout;
  scrollY: SharedValue<number>;
}): ReactElement {
  // The text before each chip stays the same object until the draft changes, so a pill and its
  // measuring copies render again only for a new draft.
  const pills = useMemo(
    () =>
      layout.spans.flatMap((span, index) =>
        span.kind === "chip" ? [{ chip: span, before: layout.spans.slice(0, index) }] : [],
      ),
    [layout.spans],
  );
  const follow = useAnimatedStyle(() => ({ transform: [{ translateY: -scrollY.get() }] }));
  return (
    <View
      style={styles.pills}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.pillsContent, follow]}>
        {pills.map(({ chip, before }) => (
          <ChipPill key={chip.segmentId} chip={chip} before={before} />
        ))}
      </Animated.View>
    </View>
  );
}

type PillPlace = { line: TextLayoutLine | null; width: number | null };

const ChipPill = memo(function ChipPill({
  chip,
  before,
}: {
  chip: ChipSpan;
  before: ComposerSpan[];
}): ReactElement {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const [place, setPlace] = useState<PillPlace>({ line: null, width: null });
  const colors = referenceChipColors(theme, chip.chip);
  const icon = referenceChipIcon(chip.chip, chip.fileKind);
  const height = PILL_HEIGHT * fontScale;
  const { line, width } = place;
  return (
    <>
      <Text
        style={[styles.text, styles.copy, styles.copyWidth]}
        textBreakStrategy="simple"
        onTextLayout={(event) => {
          const last = event.nativeEvent.lines.at(-1) ?? null;
          setPlace((current) => ({ ...current, line: last }));
        }}
      >
        <DraftText spans={before} visible={false} />
        <Text style={styles.marginStart}>{CHIP_MARGIN_START}</Text>
        <ChipLabel span={chip} visible={false} />
      </Text>
      <Text
        style={[styles.text, styles.copy]}
        numberOfLines={1}
        onTextLayout={(event) => {
          const alone = event.nativeEvent.lines[0]?.width ?? null;
          setPlace((current) => ({ ...current, width: alone }));
        }}
      >
        <ChipLabel span={chip} visible={false} />
      </Text>
      {line && width !== null ? (
        <View
          style={[
            styles.pill,
            {
              left: theme.space.md + line.x + line.width - width,
              top:
                INPUT_PADDING_VERTICAL +
                line.y +
                line.ascender -
                LABEL_MIDDLE_ABOVE_BASELINE * fontScale -
                height / 2,
              width,
              height,
              paddingLeft: PILL_PADDING * fontScale - 1,
              backgroundColor: colors.backgroundColor,
              borderColor: colors.borderColor,
            },
          ]}
        >
          {icon ? (
            <Icon name={icon} size={PILL_ICON_SIZE * fontScale} colorValue={colors.color} />
          ) : null}
        </View>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop editor: `min-h-11 px-3 py-2.5`, 15 points on a 24-point line; the phone uses one
  // step more. A multiline input with a line height moves its caret on iOS, so the input takes
  // only the size.
  input: {
    paddingHorizontal: theme.space.md,
    paddingVertical: INPUT_PADDING_VERTICAL,
  },
  text: {
    fontFamily: theme.type.body.fontFamily,
    fontSize: INPUT_FONT_SIZE,
    letterSpacing: theme.type.body.letterSpacing,
    color: theme.desktop.foreground,
  },
  marginStart: { fontSize: MARGIN_START_FONT_SIZE },
  chipText: { ...sansWeight("medium"), fontSize: 12 },
  pills: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  pillsContent: { ...StyleSheet.absoluteFillObject },
  // The copies draw nothing and take no room. Each lays out from the start of the text area of
  // the input.
  copy: {
    position: "absolute",
    top: INPUT_PADDING_VERTICAL,
    left: theme.space.md,
    opacity: 0,
  },
  copyWidth: { right: theme.space.md },
  pill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: theme.radius.pill,
  },
}));
