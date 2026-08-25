import { defineRule } from "@oxlint/plugins";

import { typeResolvesToUnknown } from "../shared/dictionary-types.ts";
import { createLazyImportedTypeResolver } from "../shared/imported-type-resolution.ts";
import { createTypeEnvironment } from "../shared/portable-type-resolution.ts";

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
    const importedTypeResolver = createLazyImportedTypeResolver(() => context.filename);

    return {
      TSTypeAliasDeclaration(alias) {
        const environment = createTypeEnvironment(
          alias.typeAnnotation,
          context.sourceCode.visitorKeys,
        );
        if (
          !typeResolvesToUnknown(alias.typeAnnotation, environment, importedTypeResolver(alias))
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
