import { Check } from "lucide-react";
import { type CSSProperties, type ReactElement, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_TILE_PALETTE,
  normalizeHexInput,
  tileColorFaceStyle,
  tileLabelSizeClass,
  tileShadeRamp,
} from "@/lib/workspace-tile-appearance";

const HEX_ERROR_MESSAGE = "Enter a 6-digit RGB hex value, such as f08c00.";

const stripHash = (hex: string): string => hex.replace(/^#/, "");

type WorkspaceTileColorPickerProps = {
  idPrefix: string;
  pickedColor: string | null;
  automaticColor: string;
  effectiveColor: string;
  abbreviationPreview: string;
  isDisabled: boolean;
  onChangeTileColor: (nextTileColor: string | null) => void;
};

function TileColorSwatchButton({
  style,
  label,
  isSelected,
  isDisabled,
  onSelect,
  children,
}: {
  style: CSSProperties;
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  children?: ReactElement | null;
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
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      {children}
      {isSelected ? <Check className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

export function WorkspaceTileColorPicker({
  idPrefix,
  pickedColor,
  automaticColor,
  effectiveColor,
  abbreviationPreview,
  isDisabled,
  onChangeTileColor,
}: WorkspaceTileColorPickerProps): ReactElement {
  const [hexInput, setHexInput] = useState(() => stripHash(effectiveColor));
  const [lastEffectiveColor, setLastEffectiveColor] = useState(effectiveColor);
  const [hexError, setHexError] = useState<string | null>(null);

  // The hex field follows every other control, so a swatch click, a shade click, the automatic
  // choice, and a switch to another repository all reset the typed text and the message.
  if (effectiveColor !== lastEffectiveColor) {
    setLastEffectiveColor(effectiveColor);
    if (normalizeHexInput(hexInput) !== effectiveColor) {
      setHexInput(stripHash(effectiveColor));
      setHexError(null);
    }
  }

  const isAutomatic = pickedColor === null;
  const shades = tileShadeRamp(effectiveColor);
  const hexFieldId = `${idPrefix}-tile-color-hex`;
  const hexErrorId = `${hexFieldId}-error`;

  const applyHexInput = (
    raw: string,
    { reportIncomplete }: { reportIncomplete: boolean },
  ): void => {
    setHexInput(raw);
    const normalized = normalizeHexInput(raw);
    if (normalized) {
      setHexError(null);
      onChangeTileColor(normalized);
      return;
    }
    const candidateLength = stripHash(raw.trim()).length;
    setHexError(reportIncomplete || candidateLength >= 6 ? HEX_ERROR_MESSAGE : null);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <p className="text-sm font-medium text-foreground">Tile color</p>
        <div className="flex flex-wrap items-center gap-2">
          <TileColorSwatchButton
            label="Automatic"
            style={tileColorFaceStyle(automaticColor)}
            isSelected={isAutomatic}
            isDisabled={isDisabled}
            onSelect={() => {
              onChangeTileColor(null);
            }}
          >
            {isAutomatic ? null : <span className="text-[0.625rem] font-semibold">A</span>}
          </TileColorSwatchButton>

          {WORKSPACE_TILE_PALETTE.map((entry) => (
            <TileColorSwatchButton
              key={entry.id}
              label={`${entry.label} (${entry.hex})`}
              style={tileColorFaceStyle(entry.hex)}
              isSelected={!isAutomatic && entry.hex === effectiveColor}
              isDisabled={isDisabled}
              onSelect={() => {
                onChangeTileColor(entry.hex);
              }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Automatic gives this workspace a color from the palette that stays stable across restarts.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium text-foreground">Shades</p>
        <div className="flex flex-wrap items-center gap-2">
          {shades.map((shade) => (
            <TileColorSwatchButton
              key={shade.level}
              label={`Shade ${shade.level} (${shade.hex})`}
              style={tileColorFaceStyle(shade.hex)}
              isSelected={!isAutomatic && shade.hex === effectiveColor}
              isDisabled={isDisabled}
              onSelect={() => {
                onChangeTileColor(shade.hex);
              }}
            />
          ))}
        </div>
      </div>

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
        </div>
        {hexError ? (
          <p id={hexErrorId} role="alert" className="text-xs text-destructive">
            {hexError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium text-foreground">Tile preview</p>
        <div className="flex items-center gap-2">
          <span
            data-testid="workspace-tile-preview"
            className={cn(
              "flex size-10 items-center justify-center rounded-lg font-semibold shadow-sm",
              tileLabelSizeClass(abbreviationPreview),
            )}
            style={tileColorFaceStyle(effectiveColor)}
          >
            {abbreviationPreview}
          </span>
        </div>
      </div>
    </div>
  );
}
