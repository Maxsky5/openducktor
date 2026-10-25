import type { WorkspaceRecord } from "@openducktor/contracts";
import { useNavigation } from "expo-router";
import { type ReactElement, useEffect, useEffectEvent } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet as NativeStyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import {
  type CreateAction,
  NO_WORKSPACE_ACTIONS,
  useRunCreateAction,
  useWorkspaceCreateActions,
} from "@/features/tasks/create-actions";
import { createButtonCenter, railCreateCenter } from "./tab-bar-geometry";
import type { TabPlacement } from "./tab-button";
import { withAlpha } from "@/theme/color-alpha";

/**
 * The actions sit on an arc beside the create button: up-left, up, and up-right over the bar, or
 * up-right, right, and down-right beside the rail. The rail arc opens wider, because each label
 * sits under its action.
 */
const ARC_RADIUS = 124;
const ARC_ANGLES = {
  bottom: [135, 90, 45],
  rail: [55, 0, -55],
} as const satisfies Record<TabPlacement, readonly number[]>;
const ACTION_SIZE = 56;
/** The box of one action: the circle and its label under it. */
const ACTION_BOX = { width: 104, height: 88 } as const;
/** Each action starts a little after the one before it. */
const STAGGER = 0.12;
/** The violet glow behind the actions: it grows from the create button and holds the arc. */
const GLOW_SIZE = 2 * (ARC_RADIUS + ACTION_SIZE);

const arcOffset = (placement: TabPlacement, index: number) => {
  const angle = ((ARC_ANGLES[placement][index] ?? 90) * Math.PI) / 180;
  return { x: Math.cos(angle) * ARC_RADIUS, y: -Math.sin(angle) * ARC_RADIUS };
};

/**
 * Places a box of `width` and `height` with the point at `inset` from its top left on the center
 * of the create button: in the middle of the bar, or in the middle of the rail edge.
 */
const atCreateButton = (
  placement: TabPlacement,
  insets: { bottom: number; left: number },
  size: { width: number; height: number },
  inset: { x: number; y: number },
): ViewStyle =>
  placement === "bottom"
    ? {
        left: "50%",
        marginLeft: -inset.x,
        bottom: createButtonCenter(insets.bottom) - (size.height - inset.y),
      }
    : { top: "50%", marginTop: -inset.y, left: railCreateCenter(insets.left) - inset.x };

/**
 * The create menu of the tab bar or the rail: three round actions open on an arc beside the create
 * button, over a scrim. A tap on the scrim, on the create button, or Back closes it.
 */
export function CreateFan({
  placement,
  progress,
  onClose,
}: {
  placement: TabPlacement;
  /** 0 while closed, 1 while open. A spring past 1 makes the actions pop. */
  progress: SharedValue<number>;
  onClose: () => void;
}): ReactElement {
  const { selectedWorkspace } = useMobileWorkspaces();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const scrim = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const glow = useAnimatedStyle(() => {
    const opacity = interpolate(progress.get(), [0, 1], [0, 1], Extrapolation.CLAMP);
    if (reducedMotion) return { opacity };
    return { opacity, transform: [{ scale: interpolate(progress.get(), [0, 1], [0.3, 1]) }] };
  });
  // The menu stays mounted while it closes under a sheet that an action opened. Back then goes to
  // the sheet.
  const navigation = useNavigation();
  const onBack = useEffectEvent(() => {
    if (!navigation.isFocused()) return false;
    onClose();
    return true;
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => subscription.remove();
  }, []);
  return (
    <View style={NativeStyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.scrim, scrim]}>
        <Pressable
          style={NativeStyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close the create menu"
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          atCreateButton(
            placement,
            insets,
            { width: GLOW_SIZE, height: GLOW_SIZE },
            { x: GLOW_SIZE / 2, y: GLOW_SIZE / 2 },
          ),
          glow,
        ]}
      />
      {selectedWorkspace ? (
        <WorkspaceActions
          workspace={selectedWorkspace}
          placement={placement}
          progress={progress}
          onClose={onClose}
        />
      ) : (
        <Actions
          actions={NO_WORKSPACE_ACTIONS}
          workspaceId={null}
          placement={placement}
          progress={progress}
          onClose={onClose}
        />
      )}
    </View>
  );
}

type FanProps = { placement: TabPlacement; progress: SharedValue<number> };

function WorkspaceActions({
  workspace,
  placement,
  progress,
  onClose,
}: FanProps & {
  workspace: WorkspaceRecord;
  onClose: () => void;
}): ReactElement {
  return (
    <Actions
      actions={useWorkspaceCreateActions(workspace)}
      workspaceId={workspace.workspaceId}
      placement={placement}
      progress={progress}
      onClose={onClose}
    />
  );
}

function Actions({
  actions,
  workspaceId,
  placement,
  progress,
  onClose,
}: FanProps & {
  actions: readonly CreateAction[];
  workspaceId: string | null;
  onClose: () => void;
}): ReactElement {
  const run = useRunCreateAction(workspaceId, onClose);
  return (
    <>
      {actions.map((action, index) => (
        <FanAction
          key={action.id}
          action={action}
          index={index}
          placement={placement}
          progress={progress}
          onPress={() => run(action)}
        />
      ))}
    </>
  );
}

function FanAction({
  action,
  index,
  placement,
  progress,
  onPress,
}: FanProps & {
  action: CreateAction;
  index: number;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const offset = arcOffset(placement, index);
  const start = index * STAGGER;
  const motion = useAnimatedStyle(() => {
    // Each action runs its own part of the shared progress, so the actions open one by one. A
    // spring past 1 overshoots each action a little, and each one rests at 1.
    const value = (progress.get() - start) / (1 - start);
    const shown = Math.min(Math.max(value, 0), 1);
    if (reducedMotion) return { opacity: shown };
    return {
      opacity: shown,
      transform: [
        { translateX: offset.x * value },
        { translateY: offset.y * value },
        { scale: interpolate(value, [0, 1], [0.4, 1]) },
      ],
    };
  });
  const blocked = action.blockedReason !== null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.actionBox,
        // The circle of the action starts on the create button.
        atCreateButton(placement, insets, ACTION_BOX, {
          x: ACTION_BOX.width / 2,
          y: ACTION_SIZE / 2,
        }),
        reducedMotion ? { transform: [{ translateX: offset.x }, { translateY: offset.y }] } : null,
        motion,
      ]}
    >
      <Touchable
        feedback="scale"
        radius={ACTION_SIZE / 2}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel}
        accessibilityHint={action.blockedReason ?? undefined}
        accessibilityState={{ disabled: blocked }}
        style={[styles.action, blocked ? styles.blocked : null]}
      >
        <Icon name={action.icon} size={24} colorValue={theme.colors.tint} />
      </Touchable>
      <View style={[styles.labelChip, blocked ? styles.blocked : null]}>
        <Text numberOfLines={1} style={styles.label}>
          {action.label}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.scrim,
  },
  glow: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    backgroundImage: `radial-gradient(circle closest-side, ${withAlpha(theme.colors.tint, 0.25)}, ${withAlpha(theme.colors.tint, 0)})`,
  },
  actionBox: {
    position: "absolute",
    width: ACTION_BOX.width,
    height: ACTION_BOX.height,
    alignItems: "center",
    gap: theme.space.sm,
  },
  // The actions share the surface of the bar, so the create button stays the one violet fill.
  action: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.hairline,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    boxShadow: theme.shadows.overlay,
  },
  blocked: { opacity: 0.45 },
  labelChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    boxShadow: theme.shadows.card,
  },
  label: {
    ...theme.type.caption1,
    color: theme.colors.label,
  },
}));
