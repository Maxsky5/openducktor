import { type ReactElement, type ReactNode, useState } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownView, type TaskImageContext } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { haptics } from "@/ui/haptics";
import { Text } from "@/ui/text";
import { FieldBox, FormField, ViewSwitch } from "./form-parts";

type EditorMode = "write" | "preview";

const MODES = [
  { value: "write", label: "Write", icon: "file-pen-line" },
  { value: "preview", label: "Preview", icon: "eye" },
] as const;

/**
 * The task description as the desktop description editor: a view switch above an outlined box.
 * Write shows the image toolbar on top and the Markdown text below it, as the desktop Markdown
 * source. Preview renders the same Markdown as the task details. `onCursorChange` reports the
 * cursor, so an image can insert there.
 */
export function MarkdownEditorField({
  label,
  value,
  onChange,
  editable,
  placeholder,
  imageContext,
  stagedImages,
  emptyPreview,
  onCursorChange,
  toolbar,
  footer,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  placeholder: string;
  imageContext: TaskImageContext | null;
  /** Images added in this editor that the host has not saved yet: asset ID to device file. */
  stagedImages?: ReadonlyMap<string, string> | undefined;
  emptyPreview: string;
  onCursorChange?: ((cursor: number) => void) | undefined;
  /** Controls above the text in Write mode, such as Add image. */
  toolbar?: ReactNode;
  /** Lines under the editor, such as the image uploads. */
  footer?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const [mode, setMode] = useState<EditorMode>("write");
  const [focused, setFocused] = useState(false);
  return (
    <FormField
      label={label}
      trailing={
        <ViewSwitch
          label={`${label} view`}
          options={MODES}
          value={mode}
          onChange={(next) => {
            haptics.selection();
            setMode(next);
          }}
        />
      }
    >
      <FieldBox focused={focused && mode === "write"} style={styles.box}>
        {mode === "write" ? (
          <>
            {toolbar ? <View style={styles.toolbar}>{toolbar}</View> : null}
            <TextInput
              value={value}
              onChangeText={onChange}
              editable={editable}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              placeholder={placeholder}
              placeholderTextColor={theme.desktop.mutedForeground}
              selectionColor={theme.colors.selection}
              selectionHandleColor={theme.colors.tint}
              cursorColor={theme.colors.tint}
              accessibilityLabel={`${label}, Markdown`}
              accessibilityState={{ disabled: !editable }}
              autoCorrect={false}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSelectionChange={(event) => onCursorChange?.(event.nativeEvent.selection.end)}
              style={styles.input}
            />
          </>
        ) : (
          <View style={styles.preview} accessibilityLabel={`${label} preview`}>
            {value.trim().length > 0 ? (
              <MarkdownView
                markdown={value}
                imageContext={imageContext}
                stagedImages={stagedImages}
                selectable
              />
            ) : (
              <Text variant="callout" tone="tertiary">
                {emptyPreview}
              </Text>
            )}
          </View>
        )}
      </FieldBox>
      {footer}
    </FormField>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { overflow: "hidden" },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space.xs,
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  input: {
    minHeight: 200,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.md,
    color: theme.desktop.foreground,
    ...theme.type.body,
  },
  preview: { minHeight: 200, padding: theme.space.md },
}));
