import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { createTypeEnvironment, typeResolvesToUnknown } from "../shared/dictionary-types.ts";
import { createImportedTypeResolver } from "../shared/imported-type-resolution.ts";
import type { PortableTypeResolver } from "../shared/portable-type-resolution.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    let resolveImportedType: PortableTypeResolver | null = null;
    const importedTypeResolver = (node: ESTree.Node): PortableTypeResolver => {
      if (resolveImportedType !== null) return resolveImportedType;
      let root = node;
      while (root.parent !== null) root = root.parent;
      resolveImportedType = createImportedTypeResolver(
        context.filename,
        root.type === "Program" ? root.body : [],
      );
      return resolveImportedType;
    };

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (
        !typeResolvesToUnknown(
          annotation.typeAnnotation,
          createTypeEnvironment(annotation.typeAnnotation, context.sourceCode.visitorKeys),
          importedTypeResolver(annotation),
        )
      ) {
        return;
      }
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    return {
      ArrowFunctionExpression(node) {
        checkReturnType(node);
      },
      FunctionDeclaration: checkReturnType,
      FunctionExpression: checkReturnType,
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
    };
  },
});
