import type { AppTheme, Tone, ToneColors } from "@/theme/tokens";

export type { Tone, ToneColors } from "@/theme/tokens";

/**
 * The desktop badge colors of a semantic status: a wash, an outline, text, and an accent for a
 * dot or an icon. Information never depends on color alone.
 */
export const toneColors = (theme: AppTheme, tone: Tone): ToneColors => theme.tones[tone];
