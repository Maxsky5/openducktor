# Scene authoring

Use ScenePlan version 2 with the pinned renderer. The templates show mechanics and example compositions. Replace their labels and code with verified PR facts, and change the layout to fit the story.

| Template | Use |
| --- | --- |
| [overview.json](../assets/overview.json) | A complete static comparison of separate destinations and a shared destination, with short labels |
| [sequence.json](../assets/sequence.json) | Requests and responses when their order is the subject; export a complete held frame for a diagram |
| [before-after.json](../assets/before-after.json) | Two protocol outcomes with stable participants and trigger; export the held before and after poses |
| [code-change.json](../assets/code-change.json) | A code excerpt that changes while unchanged line IDs stay stable |

## Static overviews

The overview uses a Stage for cards and captions for larger labels. Its channels have fixed initial values and no events, so the complete diagram appears at any frame time. Use a flat layout with restrained effects for stills. Keep bloom, grain, and vignette at zero when they reduce text clarity. Stage coordinates at depth zero are canvas pixels with the default camera. Card scale also scales its built-in type; check the rendered result.

The example is a conceptual diagram, not captured UI. Adapt its containers, labels, and relationships to the PR. It is one composition, not a required layout for every PR. For another recipe, read the pinned [recipe guide](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/SCENE_PLANS.md#build-an-explainer) and inspect the recipe source.

## Sequence and code scenes

For sequence scenes, every visible row needs a `row.<id>.reveal` channel. Use initial value `1` with no events for a static row, or animate from `0` to `1`. Rows can share a `slot` for a replacement. Finish fading out the old row before revealing the new row so their labels do not overlap.

For code scenes, the last snapshot must match `finalLineIds`. Use `mark.<lineId>` to control a line mark. Keep IDs for unchanged actors and code lines. Label shortened code as a condensed excerpt. Use real identifiers and at most 76 columns and 14 rows per excerpt.

## Validation and animation

One second is `1000000000` nanoseconds. Keep events inside `durationNanos` and use distinct channel IDs. Use `plan validate` for format checks and `plan inspect` to check the scene clock. These checks verify the plan, not the quality of its explanation. Upstream `plan schema` is a summary, not a complete JSON Schema.

For Stage animation, read [explainer-motion](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/.opencode/skills/explainer-motion/SKILL.md). Move an object to explain what it does. Use held views for reading. Revalidate the templates when upgrading the pinned revision.
