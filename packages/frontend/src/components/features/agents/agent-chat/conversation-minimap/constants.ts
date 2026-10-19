// The minimap shows only beside a transcript frame at least this wide.
export const MINIMAP_MIN_FRAME_WIDTH_PX = 560;
// The rail strip on the left of the transcript. The transcript content moves right by this width.
export const MINIMAP_GUTTER_PX = 40;
// The rail keeps this distance from the top and bottom edges of the transcript frame.
export const MINIMAP_RAIL_INSET_PX = 16;

// Distance between tick centers. Ticks move closer down to the minimum, then combine into groups.
export const MINIMAP_TICK_SPACING_PX = 12;
export const MINIMAP_MIN_TICK_SPACING_PX = 6;

// Distance from the rail start to the tick start.
export const MINIMAP_TICK_LEFT_PX = 10;
// A tick under the crest shows this full length. A tick at rest shows a part of it.
export const MINIMAP_TICK_LENGTH_PX = 28;

// Beyond the tick under the crest, ticks grow less until this distance from the crest.
export const MINIMAP_WAVE_RADIUS_PX = 40;
export const MINIMAP_WAVE_RISE_SECONDS = 0.15;
export const MINIMAP_WAVE_FALL_SECONDS = 0.25;

// Gives the pointer time to cross from the rail to the preview card.
export const MINIMAP_CARD_CLOSE_DELAY_MS = 150;
