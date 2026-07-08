# Product

## Register

product

## Users

OpenDucktor is used by developers and agent-workflow operators working inside local repositories. They need a task-centric environment where specification, planning, building, QA, Git state, documents, approvals, and delivery context stay attached to one task instead of being scattered across chat threads and terminals.

## Product Purpose

OpenDucktor is an Agentic Development Environment built around tasks, repositories, and local agent runtimes. It orchestrates Specification, Planner, Builder, and QA sessions, keeps task documents and review state connected to the task, and gives users a controlled local surface for moving work from idea to implementation.

## Brand Personality

Calm, precise, operational. The interface should feel like a serious developer tool that helps users scan state, act deliberately, and trust that workflow history remains auditable.

## Anti-references

Avoid decorative dashboard chrome, marketing-style hero composition inside product surfaces, role-specific panels that make the same task feel like separate tools, hidden critical actions, hardcoded structural colors, and UI treatments that obscure actionable failures behind empty or generic states.

## Design Principles

- Keep task context attached to the work.
- Favor dense, scannable controls over decorative layout.
- Make important actions available where users need them, not only inside one tab or role.
- Preserve local workflow trust by surfacing actionable errors instead of masking broken paths.
- Use the existing semantic token and shadcn component vocabulary before inventing new styling.

## Accessibility & Inclusion

Interactive controls must be keyboard accessible, expose useful accessible names, and remain legible in light and dark themes. Icon-only controls need labels and tooltips. Layouts should handle narrow panels, long branch names, long paths, and changing task state without overlap.
