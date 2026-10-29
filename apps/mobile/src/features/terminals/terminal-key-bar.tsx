import type {
  TerminalKeyModifiers,
  TerminalTouchKey,
} from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import * as Clipboard from "expo-clipboard";
import { type ReactElement, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { type KeyRowScroll, keysPastRightEdge } from "./terminal-key-row";

type KeyButtonProps = {
  label: string;
  accessibilityLabel: string;
  icon?: IconName | undefined;
  /** For a sticky modifier: true while it waits for the next key. */
  selected?: boolean | undefined;
  disabled: boolean;
  onPress: () => void;
};

/** A key of the row in the terminal font, in the style of a system keyboard key on the terminal. */
function KeyButton({
  label,
  accessibilityLabel,
  icon,
  selected,
  disabled,
  onPress,
}: KeyButtonProps): ReactElement {
  const theme = useAppTheme();
  const active = selected === true;
  styles.useVariants({ active });
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? { disabled } : { disabled, selected }}
      android_ripple={{ color: theme.colors.terminalMuted, borderless: false }}
      style={({ pressed }) => [
        styles.key,
        pressed && !active ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={17}
          colorValue={active ? theme.colors.terminalPanel : theme.colors.terminalForeground}
        />
      ) : (
        <Text variant="mono" weight="medium" style={styles.keyText}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const PASTE_CONTENT_TYPES: Clipboard.AcceptedContentType[] = ["plain-text"];

/** The keys keep a compact look and a touch area of the platform minimum. */
const KEY_MIN_WIDTH = Platform.select({ ios: 44, default: 48 });
const KEY_HEIGHT = KEY_MIN_WIDTH;

const ARROWS: ReadonlyArray<{ key: TerminalTouchKey; icon: IconName; label: string }> = [
  { key: "ArrowLeft", icon: "arrow-left", label: "Left arrow" },
  { key: "ArrowUp", icon: "arrow-up", label: "Up arrow" },
  { key: "ArrowDown", icon: "arrow-down", label: "Down arrow" },
  { key: "ArrowRight", icon: "arrow-right", label: "Right arrow" },
];

export type TerminalKeyBarProps = {
  /** False for an exited or lost terminal and while host commands are closed. */
  inputEnabled: boolean;
  modifiers: TerminalKeyModifiers;
  canCopy: boolean;
  canSelect: boolean;
  keyboardVisible: boolean;
  onKey: (key: TerminalTouchKey) => void;
  onToggleModifier: (modifier: keyof TerminalKeyModifiers) => void;
  /** Reads the clipboard and pastes its text. Android uses it. */
  onPaste: () => void;
  /** Pastes the text of the iOS paste control. */
  onPasteText: (text: string) => void;
  onCopy: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleKeyboard: () => void;
};

/**
 * Editing keys scroll above a fixed row of selection, clipboard, and keyboard controls.
 * A held modifier applies to the next key or typed character.
 */
export function TerminalKeyBar({
  inputEnabled,
  modifiers,
  canCopy,
  canSelect,
  keyboardVisible,
  onKey,
  onToggleModifier,
  onPaste,
  onPasteText,
  onCopy,
  onSelectAll,
  onClearSelection,
  onToggleKeyboard,
}: TerminalKeyBarProps): ReactElement {
  const theme = useAppTheme();
  const disabled = !inputEnabled;
  const toggleModifier = (modifier: keyof TerminalKeyModifiers): void => {
    haptics.selection();
    onToggleModifier(modifier);
  };
  // A narrow screen hides the last keys past the right edge. A fade there shows that the row
  // scrolls, because the row has no scroll indicator.
  const scroll = useRef<KeyRowScroll>({ offset: 0, viewport: 0, content: 0 });
  const [moreKeys, setMoreKeys] = useState(false);
  const updateScroll = (next: Partial<KeyRowScroll>): void => {
    scroll.current = { ...scroll.current, ...next };
    setMoreKeys(keysPastRightEdge(scroll.current));
  };
  return (
    <View style={styles.bar}>
      <View style={styles.keyRow}>
        <View style={styles.scroller}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keys}
            onLayout={(event) => updateScroll({ viewport: event.nativeEvent.layout.width })}
            onContentSizeChange={(width) => updateScroll({ content: width })}
            onScroll={(event) => updateScroll({ offset: event.nativeEvent.contentOffset.x })}
            scrollEventThrottle={32}
            accessibilityRole="toolbar"
            accessibilityLabel="Terminal keys"
          >
            <View style={styles.group}>
              <KeyButton
                label="esc"
                accessibilityLabel="Escape"
                disabled={disabled}
                onPress={() => onKey("Escape")}
              />
              <KeyButton
                label="tab"
                accessibilityLabel="Tab"
                disabled={disabled}
                onPress={() => onKey("Tab")}
              />
              <KeyButton
                label="ctrl"
                accessibilityLabel="Control, applies to the next key"
                selected={modifiers.ctrl}
                disabled={disabled}
                onPress={() => toggleModifier("ctrl")}
              />
              <KeyButton
                label="alt"
                accessibilityLabel="Alt, applies to the next key"
                selected={modifiers.alt}
                disabled={disabled}
                onPress={() => toggleModifier("alt")}
              />
            </View>
            <View style={styles.group}>
              {ARROWS.map((arrow) => (
                <KeyButton
                  key={arrow.key}
                  label={arrow.label}
                  accessibilityLabel={arrow.label}
                  icon={arrow.icon}
                  disabled={disabled}
                  onPress={() => onKey(arrow.key)}
                />
              ))}
            </View>
            <View style={styles.group}>
              <KeyButton
                label="⇧ tab"
                accessibilityLabel="Shift plus Tab"
                disabled={disabled}
                onPress={() => onKey("ShiftTab")}
              />
              <KeyButton
                label="⌫"
                accessibilityLabel="Backspace"
                disabled={disabled}
                onPress={() => onKey("Backspace")}
              />
              <KeyButton
                label="del"
                accessibilityLabel="Delete"
                disabled={disabled}
                onPress={() => onKey("Delete")}
              />
              <KeyButton
                label="↵"
                accessibilityLabel="Enter"
                disabled={disabled}
                onPress={() => onKey("Enter")}
              />
            </View>
          </ScrollView>
          {moreKeys ? <View pointerEvents="none" style={styles.edgeFade} /> : null}
        </View>
      </View>
      <View
        style={styles.utilities}
        accessibilityRole="toolbar"
        accessibilityLabel="Terminal output and keyboard"
      >
        <KeyButton
          label="Select all"
          accessibilityLabel="Select all terminal output"
          disabled={!canSelect}
          onPress={onSelectAll}
        />
        <KeyButton
          label="Copy"
          icon="copy"
          accessibilityLabel="Copy the selected text"
          disabled={!canCopy}
          onPress={onCopy}
        />
        <KeyButton
          label="Clear"
          icon="x"
          accessibilityLabel="Clear the selection"
          disabled={!canCopy}
          onPress={onClearSelection}
        />
        {Clipboard.isPasteButtonAvailable && !disabled ? (
          // The iOS system control reads text without a paste permission prompt.
          <Clipboard.ClipboardPasteButton
            acceptedContentTypes={PASTE_CONTENT_TYPES}
            displayMode="iconOnly"
            cornerStyle="small"
            backgroundColor={theme.colors.terminalBorder}
            foregroundColor={theme.colors.terminalForeground}
            style={styles.pasteControl}
            onPress={(data) => {
              if (data.type === "text") onPasteText(data.text);
            }}
          />
        ) : (
          <KeyButton
            label="Paste"
            accessibilityLabel="Paste from the clipboard"
            icon="clipboard-paste"
            disabled={disabled}
            onPress={onPaste}
          />
        )}
        <View style={styles.pinned}>
          <KeyButton
            label={keyboardVisible ? "Hide keyboard" : "Show keyboard"}
            accessibilityLabel={keyboardVisible ? "Hide the keyboard" : "Show the keyboard"}
            icon={keyboardVisible ? "keyboard-off" : "keyboard"}
            disabled={disabled && !keyboardVisible}
            onPress={onToggleKeyboard}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The rows read as part of the terminal: the terminal surface with a terminal border on top.
  bar: {
    borderTopWidth: theme.hairline,
    borderTopColor: theme.colors.terminalBorder,
    backgroundColor: theme.colors.terminalSurface,
  },
  keyRow: { flexDirection: "row", alignItems: "center" },
  utilities: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.xs,
    paddingBottom: theme.space.xs,
  },
  // The editing row scrolls within the available width.
  scroller: { flexGrow: 1, flexShrink: 1 },
  edgeFade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 32,
    backgroundImage: `linear-gradient(90deg, ${withAlpha(theme.colors.terminalSurface, 0)}, ${theme.colors.terminalSurface})`,
  },
  keys: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingLeft: theme.space.sm,
    paddingRight: theme.space.md,
    paddingVertical: 6,
  },
  group: { flexDirection: "row", alignItems: "center", gap: 6 },
  pinned: { marginLeft: "auto" },
  key: {
    minWidth: KEY_MIN_WIDTH,
    // A text key grows with a large text size, so its label does not clip.
    minHeight: KEY_HEIGHT,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Platform.select({ ios: 6, default: 8 }),
    borderCurve: "continuous",
    // Android clips the ripple to the key. iOS keeps the shadow outside the key.
    overflow: Platform.select({ ios: "visible", default: "hidden" }),
    // The key edge of the system keyboard.
    boxShadow: "0 1px 0 rgba(0, 0, 0, 0.6)",
    variants: {
      active: {
        true: { backgroundColor: theme.colors.terminalForeground },
        false: { backgroundColor: theme.colors.terminalBorder },
      },
    },
  },
  keyText: {
    variants: {
      active: {
        true: { color: theme.colors.terminalPanel },
        false: { color: theme.colors.terminalForeground },
      },
    },
  },
  // The system draws the paste control. It shows only with an explicit size.
  pasteControl: { width: KEY_MIN_WIDTH, height: KEY_HEIGHT },
  pressed: { backgroundColor: theme.colors.terminalMuted },
  disabled: { opacity: 0.35 },
}));
