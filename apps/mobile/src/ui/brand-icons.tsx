import type { AgentRole } from "@openducktor/core";
import type { RuntimeKind } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import type { Tone } from "@/theme/tokens";

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
const ROLE_DRAWINGS = {
  spec: (
    <>
      <Path d="M10 21H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6l5 5v2" {...STROKE} />
      <Path d="M8 7h3" {...STROKE} />
      <Path d="M8 11h2" {...STROKE} />
      <Circle cx={17} cy={17} r={4} {...STROKE} />
      <Circle cx={17} cy={17} r={1.25} fill="currentColor" />
    </>
  ),
  planner: (
    <>
      <Path d="M21 8c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 10 0" {...STROKE} />
      <Circle cx={16} cy={8} r={1.5} fill="currentColor" />
      <Circle cx={5.5} cy={18.5} r={2.5} {...STROKE} />
      <Path d="M8 18.5h5a3 3 0 0 0 2.6-1.5" {...STROKE} />
    </>
  ),
  build: (
    <>
      <Path d="M4 14.5a8 8.5 0 0 1 16 0" {...STROKE} />
      <Path d="M10 6.3V11" {...STROKE} />
      <Path d="M14 6.3V11" {...STROKE} />
      <Rect x={2} y={14.5} width={20} height={5} rx={2.5} {...STROKE} />
    </>
  ),
  qa: (
    <>
      <Circle cx={10.5} cy={10.5} r={7.5} {...STROKE} />
      <Path d="m21 21-5.2-5.2" {...STROKE} />
      <Path d="m7.5 10.5 2 2 4-4" {...STROKE} />
    </>
  ),
} satisfies Record<AgentRole, ReactElement>;

/** The desktop icon of a workflow role. */
export const RoleIcon = memo(function RoleIcon({
  role,
  size = 18,
  color,
}: {
  role: AgentRole;
  size?: number | undefined;
  color: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" color={color}>
      {ROLE_DRAWINGS[role]}
    </Svg>
  );
});

const CODEX_PATH =
  "M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z";

const CLAUDE_PATH =
  "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z";

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
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Rect width={512} height={512} fill={dark ? "#F1ECEC" : "#131010"} />
          <Path d="M320 224V352H192V224H320Z" fill={dark ? "#B7B1B1" : "#5A5858"} />
          <Path
            d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
            fill={dark ? "#211E1E" : "#FFFFFF"}
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </Svg>
      );
    case "codex":
      return (
        <Svg width={size} height={size} viewBox="0 0 256 260">
          <Path d={CODEX_PATH} fill={dark ? "#FFFFFF" : "#0D0D0D"} />
        </Svg>
      );
    case "claude":
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d={CLAUDE_PATH} fill="#D97757" fillRule="nonzero" />
        </Svg>
      );
  }
});

/** The desktop role colors: Spec violet, Planner amber, Builder sky, QA indigo. */
const ROLE_TONES = {
  spec: "pending",
  planner: "warning",
  build: "info",
  qa: "review",
} as const satisfies Record<AgentRole, Tone>;

/** The icon of a Workflow Role on a tile in its role color, as the leading mark of a row. */
export const RoleTile = memo(function RoleTile({ role }: { role: AgentRole }): ReactElement {
  return (
    <View style={[styles.tile, styles.tileTone(ROLE_TONES[role])]}>
      <TileRoleIcon role={role} />
    </View>
  );
});

/** The role icon of a tile. A theme change renders only this icon again. */
function TileRoleIcon({ role }: { role: AgentRole }): ReactElement {
  const theme = useAppTheme();
  return <RoleIcon role={role} size={17} color={theme.tones[ROLE_TONES[role]].text} />;
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
