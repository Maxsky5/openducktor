export const TOUR_VIEWS = {
  hero: async () => (await import("./scenes/hero/view")).HeroView,
  palette: async () => (await import("./scenes/palette/view")).PaletteView,
} as const;
