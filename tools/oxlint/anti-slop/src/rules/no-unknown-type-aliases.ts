import { defineRule } from "@oxlint/plugins";

import { createTypeEnvironment, typeResolvesToUnknown } from "../shared/dictionary-types.ts";

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
    },
    messages: {
      unknownAlias:
        "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the boundary that owns parsing, or use the parsed owner type.",
    },
  },
  createOnce(context) {
    return {
      TSTypeAliasDeclaration(alias) {
        const environment = createTypeEnvironment(
          alias.typeAnnotation,
          context.sourceCode.visitorKeys,
        );
        if (
          !typeResolvesToUnknown(
            alias.typeAnnotation,
            environment,
            new Map(),
            new Set([alias.id.name]),
          )
        ) {
          return;
        }
        context.report({
          node: alias.id,
          messageId: "unknownAlias",
          data: { alias: alias.id.name },
        });
      },
    };
  },
});
