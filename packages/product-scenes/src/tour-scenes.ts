// The docs client imports this registry for playback. Its React views load only on the server.
export const TOUR_SCENES = {
  hero: {
    size: { width: 1440, height: 700 },
    timeline: async () => (await import("./scenes/hero/timeline")).build,
  },
  palette: {
    size: { width: 1440, height: 740 },
    timeline: async () => (await import("./scenes/palette/timeline")).build,
  },
} as const;
