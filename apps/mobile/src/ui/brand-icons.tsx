import { RUNTIME_ICON_GEOMETRY } from "@openducktor/theme/runtime-icons";
import type { WorkflowIcon } from "@openducktor/contracts";
import type { RuntimeKind } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import type { Tone } from "@/theme/tokens";

const { codex, claude, opencode } = RUNTIME_ICON_GEOMETRY;

/**
 * The desktop role and runtime icons. Roles are custom drawings on the Lucide 24-point grid, and
 * runtimes are their brand marks, so a session reads the same on the phone and the desktop.
 */

/** The Lucide stroke in `currentColor`, the color of the drawing root. */
const STROKE = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
} as const;

/**
 * The role drawings. They are constant elements in `currentColor`, so a new color updates only
 * the drawing root.
 */
const ROLE_DRAWINGS = new Map<WorkflowIcon, ReactElement>([
  [
    "specification",
    <>
      <Path d="M10 21H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6l5 5v2" {...STROKE} />
      <Path d="M8 7h3" {...STROKE} />
      <Path d="M8 11h2" {...STROKE} />
      <Circle cx={17} cy={17} r={4} {...STROKE} />
      <Circle cx={17} cy={17} r={1.25} fill="currentColor" />
    </>,
  ],
  [
    "planning",
    <>
      <Path d="M21 8c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 10 0" {...STROKE} />
      <Circle cx={16} cy={8} r={1.5} fill="currentColor" />
      <Circle cx={5.5} cy={18.5} r={2.5} {...STROKE} />
      <Path d="M8 18.5h5a3 3 0 0 0 2.6-1.5" {...STROKE} />
    </>,
  ],
  [
    "building",
    <>
      <Path d="M4 14.5a8 8.5 0 0 1 16 0" {...STROKE} />
      <Path d="M10 6.3V11" {...STROKE} />
      <Path d="M14 6.3V11" {...STROKE} />
      <Rect x={2} y={14.5} width={20} height={5} rx={2.5} {...STROKE} />
    </>,
  ],
  [
    "quality",
    <>
      <Circle cx={10.5} cy={10.5} r={7.5} {...STROKE} />
      <Path d="m21 21-5.2-5.2" {...STROKE} />
      <Path d="m7.5 10.5 2 2 4-4" {...STROKE} />
    </>,
  ],
]);

/** The desktop icon of a workflow role. */
export const RoleIcon = memo(function RoleIcon({
  hint,
  size = 18,
  color,
}: {
  hint?: WorkflowIcon | undefined;
  size?: number | undefined;
  color: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" color={color}>
      {(hint && ROLE_DRAWINGS.get(hint)) ?? (
        <>
          <Rect x={4} y={6} width={16} height={14} rx={3} {...STROKE} />
          <Path d="M12 2v4M8 11h.01M16 11h.01M9 16h6" {...STROKE} />
        </>
      )}
    </Svg>
  );
});

/** The brand mark of an agent runtime, in the desktop colors of the current theme. */
export const RuntimeIcon = memo(function RuntimeIcon({
  runtimeKind,
  size = 16,
}: {
  runtimeKind: RuntimeKind;
  size?: number;
}): ReactElement {
  const theme = useAppTheme();
  const dark = theme.scheme === "dark";
  switch (runtimeKind) {
    case "opencode":
      return (
        <Svg width={size} height={size} viewBox={opencode.viewBox}>
          <Rect width={opencode.size} height={opencode.size} fill={dark ? "#F1ECEC" : "#131010"} />
          <Path d={opencode.centerPath} fill={dark ? "#B7B1B1" : "#5A5858"} />
          <Path
            d={opencode.outlinePath}
            fill={dark ? "#211E1E" : "#FFFFFF"}
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </Svg>
      );
    case "codex":
      return (
        <Svg width={size} height={size} viewBox={codex.viewBox}>
          <Path d={codex.path} fill={dark ? "#FFFFFF" : "#0D0D0D"} />
        </Svg>
      );
    case "claude":
      return (
        <Svg width={size} height={size} viewBox={claude.viewBox}>
          <Path d={claude.path} fill="#D97757" fillRule="nonzero" />
        </Svg>
      );
  }
});

/** The desktop role colors: Spec violet, Planner amber, Builder sky, QA indigo. */
const ROLE_TONES = new Map<WorkflowIcon, Tone>([
  ["specification", "pending"],
  ["planning", "warning"],
  ["building", "info"],
  ["quality", "review"],
]);

/** The icon of a Workflow Role on a tile in its role color, as the leading mark of a row. */
export const RoleTile = memo(function RoleTile({
  hint,
}: {
  hint?: WorkflowIcon | undefined;
}): ReactElement {
  return (
    <View style={[styles.tile, styles.tileTone(roleTone(hint))]}>
      <TileRoleIcon hint={hint} />
    </View>
  );
});

/** The role icon of a tile. A theme change renders only this icon again. */
const roleTone = (hint: WorkflowIcon | undefined): Tone =>
  (hint && ROLE_TONES.get(hint)) ?? "neutral";
function TileRoleIcon({ hint }: { hint?: WorkflowIcon | undefined }): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon hint={hint} size={17} color={theme.tones[roleTone(hint)].text} />;
}

const styles = StyleSheet.create((theme) => ({
  tile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTone: (tone: Tone) => ({
    backgroundColor: theme.tones[tone].surface,
    borderColor: theme.tones[tone].border,
  }),
}));
