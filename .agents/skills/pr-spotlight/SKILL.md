---
name: pr-spotlight
description: Explain PR changes with clear diagrams and short animations when motion adds information. Use when preparing a PR or asked to explain a diff visually.
---

# PR spotlight

Show the changed behavior with a visual that reviewers can check against the diff.

## Workflow

1. Inspect the diff and source at both revisions. Record the base and head SHA. Read linked task specifications and plans when available. Write the source for each visible claim in `build/pr-spotlight/<topic>/evidence.md`.
2. Write the review question and format choice in the evidence notes. Default to one PNG. Add a second for a separate question or a comparison that needs two readable views. Protocol order and before/after changes usually fit static diagrams. Choose video when motion explains timing, overlapping activity, or an interaction that one or two stills cannot explain, or when the user requests video. State what motion adds before authoring it. Use PR text when a visual adds no explanation.
3. Author the trigger, old behavior, new behavior, and scope for the chosen format. Use a template that fits the review question and save it in `build/pr-spotlight/<topic>/scene.json`. Keep IDs for unchanged actors and code lines. Show behavior before code. Label shortened code as a condensed excerpt. Use real identifiers and at most 76 columns and 14 rows per excerpt. Include error or reset paths when they affect the story. Label the output as a diagram or captured UI footage. For measurements, state the source, workload, platform, sample count, and units. Every label and snippet must match the recorded source.
4. Validate and inspect the plan. Open each PNG at the PR display size. Check text, overlap, actor identity, and whether it answers its review question. Use the same explicit `--theme` for all views. For video, inspect frames before, during, and after each transition with `--shutter`, then play the clip to check pacing and its final hold. Use `ffprobe` to check video encoding and file size. Finish when every visible claim has a source and the chosen media pass these checks. State any check you could not run.
5. Return the chosen media, editable scene, evidence notes, and PR text with useful alt text and media links. Publish within the authorized PR workflow. Read the current PR body and preserve its text and attachments. If an upload or PR command fails, inspect the live PR before repeating it, because partial failures can leave a PR or uploaded media.

## Diagrams

Use labelled before/after views with matching actors and layout for direct comparison. Keep comparison views distinct from the chronological steps of one request. Show where work or data changes, what stays, and the relevant exception path. Use action labels; add API names where they help reviewers locate the code.

Put a reset or error path in a second diagram when it makes the main comparison hard to read. Crop unused space and check that labels remain readable at the PR display width. Author complete still views; a video's final frame may omit its earlier states.

## Rendering

Run from the repository root. Setup needs Bun and a current stable Rust toolchain with Cargo. Video export needs FFmpeg with `ffprobe` and `libx264`. Frame and video rendering need a working GPU.

```sh
rtk bun .agents/skills/pr-spotlight/scripts/render.ts setup
rtk bun .agents/skills/pr-spotlight/scripts/render.ts --help
```

Run setup once per checkout. It compiles a pinned [Psychopomp](https://github.com/kitlangton/psychopomp) revision into `build/pr-spotlight/toolchain/`. The first build can take several minutes. Human contributors can omit `rtk` if they do not use it.

Use the helper's `--help` for command syntax. The pinned upstream binary treats `--help` as a video output path. Keep generated media in `build/pr-spotlight/<topic>/`.

## Templates

The templates use ScenePlan version 2. Replace their example labels and code.

| Template | Use |
| --- | --- |
| [sequence.json](assets/sequence.json) | Show requests and responses in order. Export the final frame for a diagram. |
| [before-after.json](assets/before-after.json) | Keep participants and trigger stable. Export the held before and after poses as PNGs for a static comparison. |
| [code-change.json](assets/code-change.json) | Replace a code excerpt while keeping IDs for unchanged lines. |

For sequence scenes, every visible row needs a `row.<id>.reveal` channel. Use initial value `1` with no events for a static row, or animate from `0` to `1`. Rows can share a `slot` for a replacement. Finish fading out the old row before revealing the new row so their labels do not overlap.

For code scenes, the last snapshot must match `finalLineIds`. Use `mark.<lineId>` to control a line mark.

One second is `1000000000` nanoseconds. Keep events inside `durationNanos` and use distinct channel IDs. Use `plan validate` for format checks. Upstream `plan schema` is a summary, not a complete JSON Schema. For other visual types, read the pinned [recipe guide](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/SCENE_PLANS.md#build-an-explainer) and inspect the recipe source. For Stage choreography, also read [explainer-motion](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/.opencode/skills/explainer-motion/SKILL.md). Revalidate the templates when upgrading the pinned revision.

## Media delivery

For video, use a short silent clip with one focal action per beat and still holds for reading. Render a 2 to 3 second transition window before the full clip. Use `encode` to create an MP4 within the size budget. Shorten the clip if compression makes text unreadable. Include a PNG summary for readers who cannot play the clip.

Follow [GitHub's attachment instructions](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli). Check `gh pr edit --help` for `--attach` before using it. CLI attachments need repository push access. Otherwise return the local files for the contributor to attach in GitHub. Include the editable scene and evidence notes in the handoff.
