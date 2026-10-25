import {
  Fragment,
  type PropsWithChildren,
  type ReactElement,
  type RefObject,
  useImperativeHandle,
  useMemo,
} from "react";
import { type ScaledSize, useWindowDimensions, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { type EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useOptionalCommandGate } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import type { AgentRole } from "@openducktor/core";
import { AnchoredPopover, useAnchoredPopover } from "./anchored-popover";
import { RoleIcon } from "./brand-icons";
import { Icon } from "./icon";
import type { IconName } from "./icon-names";
import { MenuTriggerContext } from "./menu-trigger-context";
import {
  MENU_CARD_PADDING,
  MENU_COLUMN_WIDTH,
  MENU_ITEM_HEIGHT,
  menuColumnCount,
  splitMenuColumns,
} from "./menu-columns";
import { Text } from "./text";
import { Touchable } from "./touchable";

export type ActionMenuItem = {
  id: string;
  title: string;
  icon?: IconName | undefined;
  /** A Workflow Role whose icon replaces `icon`, as on the desktop role actions. */
  role?: AgentRole | undefined;
  destructive?: boolean | undefined;
  disabled?: boolean | undefined;
  /** A second line under the title, such as the date of a document. */
  detail?: string | undefined;
  /** True when `detail` is a path. A long path keeps both ends, so two paths stay apart. */
  detailIsPath?: boolean | undefined;
  /** Shows a check mark, for a choice menu. */
  checked?: boolean | undefined;
  /** True when the action sends a host command; it then follows the command gate. */
  command?: boolean | undefined;
};

/** Opens a menu from code, such as from the long press of a row. */
export type ActionMenuHandle = { show: () => void };

/** The line heights of an item title, a detail line, and the menu title at the default text size. */
const TITLE_LINE = 22;
const DETAIL_LINE = 18;
const HEADING_LINE = 16;

/**
 * The desktop dropdown menu: a white card with an outline and a shadow, Lucide icons, and the
 * brand type, anchored to its trigger. A visible control opens it, so every action stays
 * reachable without a gesture. Rows can also open it with a long press.
 */
export function ActionMenu({
  title,
  items,
  onSelect,
  accessibilityLabel,
  openOnLongPress = false,
  fill = false,
  menuRef,
  children,
}: PropsWithChildren<{
  title?: string | undefined;
  /** The spoken name of a menu without a title. */
  accessibilityLabel?: string | undefined;
  items: readonly ActionMenuItem[];
  onSelect: (id: string) => void;
  openOnLongPress?: boolean;
  /** Stretches the trigger to the width of its container, such as a full-width form row. */
  fill?: boolean | undefined;
  /** Opens the menu from code, such as from the long press of a row that has its own press. */
  menuRef?: RefObject<ActionMenuHandle | null> | undefined;
}>): ReactElement {
  const gate = useOptionalCommandGate();
  const commandsBlocked = gate !== null && !gate.open;
  const popover = useAnchoredPopover(
    (screen, insets) => menuLayout(items, title, screen, insets).size,
  );
  const { show, close } = popover;
  useImperativeHandle(menuRef, () => ({ show }), [show]);

  // On iOS the choice runs after the menu has closed, so it can open a dialog or a native picker.
  const choose = (id: string) => close(() => onSelect(id));
  const triggerValue = useMemo(
    () => ({ open: show, onLongPress: openOnLongPress }),
    [openOnLongPress, show],
  );

  return (
    <View ref={popover.trigger} collapsable={false} style={fill ? styles.fill : null}>
      <MenuTriggerContext value={triggerValue}>{children}</MenuTriggerContext>
      <AnchoredPopover
        popover={popover}
        accessibilityRole="menu"
        accessibilityLabel={title ?? accessibilityLabel}
      >
        <MenuTriggerContext value={null}>
          <MenuCard
            title={title}
            items={items}
            commandsBlocked={commandsBlocked}
            onChoose={choose}
          />
        </MenuTriggerContext>
      </AnchoredPopover>
    </View>
  );
}

/**
 * The columns of a menu and the size of its card, for the window and safe area at the time it
 * opens. Only the text lines grow with the system text size. The height estimate chooses the side
 * of the trigger; above it, the menu sits on the trigger whatever its real height is.
 */
const menuLayout = (
  items: readonly ActionMenuItem[],
  title: string | undefined,
  screen: ScaledSize,
  insets: EdgeInsets,
) => {
  const scale = Math.max(1, screen.fontScale);
  const itemHeight = (item: ActionMenuItem): number =>
    Math.max(MENU_ITEM_HEIGHT, TITLE_LINE * scale + 10) + (item.detail ? DETAIL_LINE * scale : 0);
  const headingHeight = title ? HEADING_LINE * scale + 18 : 0;
  const ordered = orderMenuItems(items);
  const columnCount = menuColumnCount({
    itemsHeight: ordered.reduce((sum, item) => sum + itemHeight(item), 0),
    headingHeight,
    window: {
      width: screen.width - insets.left - insets.right,
      height: screen.height - insets.top - insets.bottom,
    },
  });
  const columns = splitMenuColumns(ordered, columnCount);
  const tallestColumn = Math.max(
    ...columns.map((column) => column.reduce((sum, item) => sum + itemHeight(item), 0)),
  );
  return {
    columns,
    size: {
      width: MENU_COLUMN_WIDTH * columns.length,
      height: tallestColumn + headingHeight + 2 * MENU_CARD_PADDING,
    },
  };
};

/** The card of an open menu. It mounts only while the menu is open. */
function MenuCard({
  title,
  items,
  commandsBlocked,
  onChoose,
}: {
  title: string | undefined;
  items: readonly ActionMenuItem[];
  commandsBlocked: boolean;
  onChoose: (id: string) => void;
}): ReactElement {
  const { columns } = menuLayout(items, title, useWindowDimensions(), useSafeAreaInsets());
  return (
    <View style={styles.content}>
      {title ? (
        <Text variant="caption2" tone="tertiary" overline numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      ) : null}
      {/* A menu taller than the space beside its trigger, such as a long session history, scrolls. */}
      <ScrollView style={styles.items} bounces={false} showsVerticalScrollIndicator>
        <View style={styles.columns}>
          {columns.map((column) => (
            <View key={column[0]?.id} style={styles.column}>
              <MenuItems items={column} commandsBlocked={commandsBlocked} onChoose={onChoose} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Destructive actions always close the menu, in their own group, as on desktop. */
const orderMenuItems = (items: readonly ActionMenuItem[]): ActionMenuItem[] => [
  ...items.filter((item) => item.destructive !== true),
  ...items.filter((item) => item.destructive === true),
];

/**
 * The rows of one menu column. They mount when the menu opens, so they read the current theme: a
 * mounted component that never read a color keeps the theme of its first render.
 */
function MenuItems({
  items,
  commandsBlocked,
  onChoose,
}: {
  items: readonly ActionMenuItem[];
  commandsBlocked: boolean;
  onChoose: (id: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <>
      {items.map((item, index) => {
        const disabled = (item.disabled ?? false) || ((item.command ?? false) && commandsBlocked);
        const previous = items[index - 1];
        // Destructive actions sit in their own group at the end.
        const divides =
          item.destructive === true && previous !== undefined && previous.destructive !== true;
        const color = item.destructive ? theme.colors.redText : theme.colors.label;
        return (
          <Fragment key={item.id}>
            {divides ? <View style={styles.divider} /> : null}
            <Touchable
              feedback="highlight"
              onPress={() => onChoose(item.id)}
              disabled={disabled}
              radius={theme.radius.md}
              accessibilityRole="menuitem"
              accessibilityLabel={item.detail ? `${item.title}, ${item.detail}` : item.title}
              accessibilityState={{ disabled, checked: item.checked }}
              style={styles.item}
            >
              {item.role ? (
                <RoleIcon
                  role={item.role}
                  size={17}
                  color={item.destructive ? color : theme.colors.secondaryLabel}
                />
              ) : item.icon ? (
                <Icon
                  name={item.icon}
                  size={17}
                  colorValue={item.destructive ? color : theme.colors.secondaryLabel}
                />
              ) : null}
              <View style={styles.itemText}>
                <Text variant="body" weight="medium" numberOfLines={2} style={{ color }}>
                  {item.title}
                </Text>
                {item.detail ? (
                  <Text
                    variant="footnote"
                    tone="secondary"
                    numberOfLines={1}
                    ellipsizeMode={item.detailIsPath ? "middle" : "tail"}
                  >
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              {item.checked ? <Icon name="check" size={17} color="tint" /> : null}
            </Touchable>
          </Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { alignSelf: "stretch" },
  content: { flexShrink: 1, padding: MENU_CARD_PADDING },
  items: { flexGrow: 0, flexShrink: 1 },
  columns: { flexDirection: "row" },
  column: { flex: 1, minWidth: 0 },
  title: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 },
  item: {
    minHeight: MENU_ITEM_HEIGHT - 2,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: 10,
  },
  itemText: { flex: 1, paddingVertical: 4 },
  divider: {
    height: theme.hairline,
    marginVertical: 4,
    marginHorizontal: 4,
    backgroundColor: theme.colors.separator,
  },
}));
