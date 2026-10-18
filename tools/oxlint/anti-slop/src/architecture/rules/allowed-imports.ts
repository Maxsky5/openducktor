import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type AllowedImports = { root: string; packages: string[]; message: string };

const isAllowedImports = (option: unknown): option is AllowedImports =>
	option !== null &&
	typeof option === "object" &&
	"root" in option &&
	typeof option.root === "string" &&
	"packages" in option &&
	Array.isArray(option.packages) &&
	option.packages.every((name) => typeof name === "string") &&
	"message" in option &&
	typeof option.message === "string";

const isRelative = (source: string): boolean =>
	source === "." || source === ".." || source.startsWith("./") || source.startsWith("../");

const isAllowedPackage = (source: string, packages: readonly string[]): boolean =>
	packages.some((name) => source === name || source.startsWith(`${name}/`));

/** Reports an import that is neither an allowed package nor a relative path inside the root. */
export const allowedImportsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Allow only the configured packages and relative imports that stay inside the configured root directory.",
		},
		messages: {
			packageNotAllowed: "'{{source}}' is not an allowed package. {{message}}",
			outsideRoot: "'{{source}}' leaves {{root}}. {{message}}",
		},
		schema: [
			{
				type: "object",
				properties: {
					root: { type: "string" },
					packages: { type: "array", items: { type: "string" } },
					message: { type: "string" },
				},
				required: ["root", "packages", "message"],
				additionalProperties: false,
			},
		],
	},
	create(context) {
		const [option] = context.options;
		if (!isAllowedImports(option)) return {};
		// A leading slash gives Windows paths such as `C:/repo` the same shape as POSIX paths.
		const filePath = `/${context.filename.replaceAll("\\", "/").replace(/^\/+/u, "")}`;
		const rootIndex = filePath.indexOf(`/${option.root}/`);
		const rootPath = rootIndex === -1 ? null : filePath.slice(0, rootIndex + option.root.length + 2);

		const check = (node: ESTree.Node, source: string): void => {
			if (isRelative(source)) {
				// `URL` resolves `.` and `..` segments the same way on every platform.
				const target = decodeURIComponent(new URL(source, `file://${filePath}`).pathname);
				if (rootPath !== null && target.startsWith(rootPath)) return;
				context.report({
					node,
					messageId: "outsideRoot",
					data: { source, root: option.root, message: option.message },
				});
				return;
			}
			if (isAllowedPackage(source, option.packages)) return;
			context.report({
				node,
				messageId: "packageNotAllowed",
				data: { source, message: option.message },
			});
		};

		return {
			ImportDeclaration(node) {
				check(node.source, node.source.value);
			},
			ExportNamedDeclaration(node) {
				if (node.source) check(node.source, node.source.value);
			},
			ExportAllDeclaration(node) {
				check(node.source, node.source.value);
			},
			ImportExpression(node) {
				if (node.source.type === "Literal" && typeof node.source.value === "string") {
					check(node.source, node.source.value);
				}
			},
			TSImportType(node) {
				check(node.source, node.source.value);
			},
		};
	},
});
