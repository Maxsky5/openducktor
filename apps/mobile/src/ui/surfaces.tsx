import {
  Children,
  createContext,
  isValidElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  use,
} from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Icon, type IconName } from "./icon";
import { TextPlaceholder } from "./placeholders";
import { Text, type TextVariant } from "./text";
import { Touchable } from "./touchable";

/** The label above a group, as the desktop section labels ("WORKSPACE"). */
export function SectionHeader({
  title,
  trailing,
  first = false,
  plain = false,
}: {
  title: string;
  trailing?: ReactNode;
  /** The first header of a screen needs less space above it. */
  first?: boolean;
  /** A header of a full-width list instead of a card group. */
  plain?: boolean;
}): ReactElement {
  styles.useVariants({ first, plain });
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <Text variant="caption2" tone="tertiary" overline numberOfLines={1} style={styles.flex}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

/** The text under a group, such as an explanation of the rows. */
export function SectionFooter({ text }: { text: string }): ReactElement {
  return (
    <Text variant="footnote" tone="tertiary" style={styles.sectionFooter}>
      {text}
    </Text>
  );
}

type RowPosition = { first: boolean; last: boolean };
const RowPositionContext = createContext<RowPosition | null>(null);

const ONLY_ROW: RowPosition = { first: true, last: true };
const FIRST_ROW: RowPosition = { first: true, last: false };
const MIDDLE_ROW: RowPosition = { first: false, last: false };
const LAST_ROW: RowPosition = { first: false, last: true };

/** One shared value for each place in a group, so a row redraws only when its place changes. */
const rowPosition = (index: number, count: number): RowPosition => {
  if (count === 1) return ONLY_ROW;
  if (index === 0) return FIRST_ROW;
  return index === count - 1 ? LAST_ROW : MIDDLE_ROW;
};

/** A group of rows in one card. Each row draws its separator from its position in the group. */
export function ListSection({
  title,
  footer,
  trailing,
  first = false,
  children,
}: PropsWithChildren<{
  title?: string | undefined;
  footer?: string | null | undefined;
  trailing?: ReactNode;
  first?: boolean;
}>): ReactElement {
  // Each row is an element. `Children.toArray` gives it a key, which keeps the row mounted when a
  // row before it goes away.
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View>
      {title ? <SectionHeader title={title} trailing={trailing} first={first} /> : null}
      <View style={[styles.group, !title && styles.groupWithoutTitle]}>
        {rows.map((row, index) => (
          <RowPositionContext key={row.key} value={rowPosition(index, rows.length)}>
            {row}
          </RowPositionContext>
        ))}
      </View>
      {footer ? <SectionFooter text={footer} /> : null}
    </View>
  );
}

export type ListRowProps = {
  title: string;
  subtitle?: string | null | undefined;
  /** Extra detail under the subtitle, such as a status line. */
  meta?: ReactNode | undefined;
  /** A secondary value at the trailing edge, such as "Connected". */
  value?: string | null | undefined;
  /** An icon in a small tinted tile. */
  icon?: IconName | undefined;
  /** The tile color of `icon`. */
  iconColor?: string | undefined;
  leading?: ReactNode | undefined;
  trailing?: ReactNode | undefined;
  /** `chevron` for a row that opens a screen, `check` for a selected choice. */
  accessory?: "chevron" | "check" | "none" | undefined;
  destructive?: boolean | undefined;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  titleLines?: number | undefined;
  testID?: string | undefined;
};

/** A row of a list section. Outside a section it is a plain row on the screen background. */
export function ListRow({
  title,
  subtitle,
  meta,
  value,
  icon,
  iconColor,
  leading,
  trailing,
  accessory,
  destructive = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  selected = false,
  disabled = false,
  titleLines = 2,
  testID,
}: ListRowProps): ReactElement {
  const position = use(RowPositionContext);
  styles.useVariants({ destructive });
  const content = (
    <>
      <RowSeparator inset={icon !== undefined || leading !== undefined} />
      {icon ? <RowIconTile icon={icon} color={iconColor} /> : null}
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" tone="tertiary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta}
      </View>
      {value ? (
        <Text variant="callout" tone="tertiary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      <RowAccessory accessory={accessory} pressable={onPress !== undefined} selected={selected} />
    </>
  );
  const rowStyle = [styles.row, position === null && styles.plainRow];
  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Touchable
      testID={testID}
      feedback="highlight"
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      style={rowStyle}
    >
      {content}
    </Touchable>
  );
}

/**
 * A list row for a first load: the leading tile, and bars in place of the title and of one line
 * under it. It uses the row styles, so the loaded row takes its exact place. Put it in the
 * `ListSection` of the rows.
 */
export function ListRowPlaceholder({
  leadingSize,
  titleWidth,
  detail,
}: {
  /** The size of the leading tile of the loaded row, or nothing for a row without one. */
  leadingSize?: number | undefined;
  titleWidth: DimensionValue;
  /** A line under the title, such as a subtitle or a path. */
  detail?: { variant: TextVariant; width: DimensionValue } | undefined;
}): ReactElement {
  const position = use(RowPositionContext);
  return (
    <View style={[styles.row, position === null && styles.plainRow]}>
      <RowSeparator inset={leadingSize !== undefined} />
      {leadingSize === undefined ? null : (
        <View style={styles.leading}>
          <View style={styles.placeholderTile(leadingSize)} />
        </View>
      )}
      <View style={styles.body}>
        <TextPlaceholder width={titleWidth} />
        {detail ? <TextPlaceholder variant={detail.variant} width={detail.width} /> : null}
      </View>
    </View>
  );
}

/** The hairline above each row of a section but the first. A leading item insets it. */
function RowSeparator({ inset }: { inset: boolean }): ReactElement | null {
  const position = use(RowPositionContext);
  if (position === null || position.first) return null;
  return <View style={[styles.separator, inset && styles.separatorInset]} />;
}

/** The icon of a row in a small tile, tinted with `color` when the row has one. */
function RowIconTile({ icon, color }: { icon: IconName; color: string | undefined }): ReactElement {
  return (
    <View style={[styles.iconTile, color ? { backgroundColor: color } : null]}>
      <Icon name={icon} size={16} color={color ? "onTint" : "tint"} />
    </View>
  );
}

/**
 * The chevron of a row that opens a screen, and the check of a selected choice. A pressable row
 * that is not selected shows a chevron unless `accessory` says otherwise.
 */
function RowAccessory({
  accessory,
  pressable,
  selected,
}: {
  accessory: ListRowProps["accessory"];
  pressable: boolean;
  selected: boolean;
}): ReactElement {
  const shown = accessory ?? (pressable && !selected ? "chevron" : "none");
  return (
    <>
      {shown === "chevron" ? <Icon name="chevron-right" size={16} color="quaternaryLabel" /> : null}
      {shown === "check" || selected ? <Icon name="check" size={18} color="tint" /> : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    paddingBottom: theme.space.sm,
    variants: {
      plain: {
        true: { paddingHorizontal: theme.layout.screenPadding },
        false: { paddingHorizontal: theme.layout.screenPadding + 4 },
      },
      first: {
        true: { paddingTop: theme.space.lg },
        false: { paddingTop: theme.space.xxl },
      },
    },
  },
  sectionFooter: {
    paddingHorizontal: theme.layout.screenPadding + 4,
    paddingTop: theme.space.sm,
  },
  group: {
    marginHorizontal: theme.layout.screenPadding,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    boxShadow: theme.shadows.card,
  },
  groupWithoutTitle: { marginTop: theme.space.lg },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.colors.surface,
  },
  plainRow: { backgroundColor: theme.colors.background },
  separator: {
    position: "absolute",
    top: 0,
    right: 0,
    left: theme.space.lg,
    height: theme.hairline,
    backgroundColor: theme.colors.separator,
  },
  separatorInset: { left: theme.space.lg + 32 + theme.space.md },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.tintSoft,
  },
  leading: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  title: {
    ...theme.type.body,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    variants: {
      destructive: {
        true: { color: theme.colors.redText },
        false: { color: theme.colors.label },
      },
    },
  },
  value: { maxWidth: "45%" },
  placeholderTile: (size: number) => ({
    width: size,
    height: size,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    backgroundColor: theme.colors.fill,
  }),
  trailing: { alignItems: "flex-end", justifyContent: "center", gap: theme.space.xs },
}));
