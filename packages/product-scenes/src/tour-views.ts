export const TOUR_VIEWS = {
  hero: async () => (await import("./scenes/hero/view")).HeroView,
  palette: async () => (await import("./scenes/palette/view")).PaletteView,
  "workflow-editor": async () => (await import("./scenes/workflow-editor/view")).WorkflowEditorView,
} as const;
