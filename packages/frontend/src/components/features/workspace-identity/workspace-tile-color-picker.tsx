import { Check, Slash } from "lucide-react";
import { type CSSProperties, type ReactElement, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_TILE_PALETTE,
  normalizeHexInput,
  tileColorFaceStyle,
  tileShadeRamp,
} from "@/lib/workspace-tile-appearance";

const HEX_ERROR_MESSAGE = "Enter a 6-digit RGB hex value, such as f08c00.";

const stripHash = (hex: string): string => hex.replace(/^#/, "");

const PALETTE_HEX_VALUES = new Set(WORKSPACE_TILE_PALETTE.map((entry) => entry.hex));

/**
 * Which control set the current color. Two controls can produce the same value, white for example,
 * so the ring follows the control the user last used instead of every control that matches.
 */
type TileColorSource = "swatch" | "shade" | "hex";

/**
 * The hex slot starts empty, so a color that is already on the palette came from its swatch and
 * anything else came from the shade row, which always holds the picked color at its own level.
 */
const initialColorSource = (pickedColor: string | null): TileColorSource =>
  pickedColor !== null && PALETTE_HEX_VALUES.has(pickedColor) ? "swatch" : "shade";

type WorkspaceTileColorPickerProps = {
  idPrefix: string;
  /** The color the user picked, or `null` for the default tile color. */
  pickedColor: string | null;
  isDisabled: boolean;
  onChangeTileColor: (nextTileColor: string | null) => void;
};

function TileColorSwatchButton({
  style,
  className,
  label,
  isSelected,
  isDisabled,
  onSelect,
  children,
  showSelectionCheck = true,
}: {
  style?: CSSProperties;
  className?: string;
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  children?: ReactElement | null;
  /** The ring already marks the selection on a swatch whose own glyph must stay visible. */
  showSelectionCheck?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isSelected}
      disabled={isDisabled}
      onClick={onSelect}
      style={style}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border border-border/60 outline-none",
        className,
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      {children}
      {isSelected && showSelectionCheck ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

export function WorkspaceTileColorPicker({
  idPrefix,
  pickedColor,
  isDisabled,
  onChangeTileColor,
}: WorkspaceTileColorPickerProps): ReactElement {
  // The hex field is its own slot. It starts empty and no swatch or shade click ever rewrites it,
  // so a typed color stays available and only loses the selection ring. The picked color is
  // already shown by its swatch, or by the shade row, which always holds it at its own level.
  const [hexInput, setHexInput] = useState("");
  const [hexError, setHexError] = useState<string | null>(null);
  const [colorSource, setColorSource] = useState<TileColorSource>(() =>
    initialColorSource(pickedColor),
  );

  const selectColor = (nextColor: string, source: TileColorSource): void => {
    setColorSource(source);
    onChangeTileColor(nextColor);
  };

  const hasColor = pickedColor !== null;
  const shades = hasColor ? tileShadeRamp(pickedColor) : [];
  const hexColor = normalizeHexInput(hexInput);
  const hexFieldId = `${idPrefix}-tile-color-hex`;
  const hexErrorId = `${hexFieldId}-error`;

  const applyHexInput = (
    raw: string,
    { reportIncomplete }: { reportIncomplete: boolean },
  ): void => {
    setHexInput(raw);
    const candidateLength = stripHash(raw.trim()).length;
    // Clearing the field only empties the slot. The picked color changes through the swatches.
    if (candidateLength === 0) {
      setHexError(null);
      return;
    }
    const normalized = normalizeHexInput(raw);
    if (normalized) {
      setHexError(null);
      selectColor(normalized, "hex");
      return;
    }
    setHexError(reportIncomplete || candidateLength >= 6 ? HEX_ERROR_MESSAGE : null);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <p className="text-sm font-medium text-foreground">Tile color</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* The default swatch stays neutral and shows a no-color slash. The primary accent would
              promise a color the rail only shows while the workspace is selected. The slash stays
              visible when the swatch is selected, and the ring carries the selection instead. */}
          <TileColorSwatchButton
            label="Default"
            className="bg-card text-muted-foreground"
            isSelected={!hasColor}
            isDisabled={isDisabled}
            showSelectionCheck={false}
            onSelect={() => {
              onChangeTileColor(null);
            }}
          >
            <Slash className="size-4" aria-hidden="true" />
          </TileColorSwatchButton>

          {WORKSPACE_TILE_PALETTE.map((entry) => (
            <TileColorSwatchButton
              key={entry.id}
              label={`${entry.label} (${entry.hex})`}
              style={tileColorFaceStyle(entry.hex)}
              isSelected={colorSource === "swatch" && entry.hex === pickedColor}
              isDisabled={isDisabled}
              onSelect={() => {
                selectColor(entry.hex, "swatch");
              }}
            />
          ))}
        </div>
      </div>

      {hasColor ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">Shades</p>
          <div className="flex flex-wrap items-center gap-2">
            {shades.map((shade) => (
              <TileColorSwatchButton
                key={shade.level}
                label={`Shade ${shade.level} (${shade.hex})`}
                style={tileColorFaceStyle(shade.hex)}
                isSelected={colorSource === "shade" && shade.hex === pickedColor}
                isDisabled={isDisabled}
                onSelect={() => {
                  selectColor(shade.hex, "shade");
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={hexFieldId}>Hex code</Label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="font-mono text-sm text-muted-foreground">
            #
          </span>
          <Input
            id={hexFieldId}
            className="max-w-40 font-mono"
            value={hexInput}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            disabled={isDisabled}
            aria-invalid={hexError !== null}
            aria-describedby={hexError ? hexErrorId : undefined}
            onChange={(event) => {
              applyHexInput(event.currentTarget.value, { reportIncomplete: false });
            }}
            onBlur={(event) => {
              applyHexInput(event.currentTarget.value, { reportIncomplete: true });
            }}
          />
          {hexColor ? (
            <TileColorSwatchButton
              label={`Hex color (${hexColor})`}
              style={tileColorFaceStyle(hexColor)}
              isSelected={colorSource === "hex" && hexColor === pickedColor}
              isDisabled={isDisabled}
              onSelect={() => {
                selectColor(hexColor, "hex");
              }}
            />
          ) : null}
        </div>
        {hexError ? (
          <p id={hexErrorId} role="alert" className="text-xs text-destructive">
            {hexError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
