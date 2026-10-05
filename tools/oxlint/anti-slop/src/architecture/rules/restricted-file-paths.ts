import { defineRule } from "@oxlint/plugins";

type RestrictedFilePath = { pattern: string; message: string };

const isRestrictedFilePath = (option: unknown): option is RestrictedFilePath =>
	option !== null &&
	typeof option === "object" &&
	"pattern" in option &&
	typeof option.pattern === "string" &&
	"message" in option &&
	typeof option.message === "string";

/** Reports a file whose forward-slash path matches a configured regular expression. */
export const restrictedFilePathsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow files at paths that the configured patterns restrict.",
		},
		messages: {
			restrictedFilePath: "{{message}}",
		},
		schema: {
			type: "array",
			items: {
				type: "object",
				properties: {
					pattern: { type: "string" },
					message: { type: "string" },
				},
				required: ["pattern", "message"],
				additionalProperties: false,
			},
		},
	},
	create(context) {
		const filePath = context.filename.replaceAll("\\", "/");
		const restrictions = context.options.filter(isRestrictedFilePath);

		return {
			Program(node) {
				for (const restriction of restrictions) {
					if (!new RegExp(restriction.pattern, "u").test(filePath)) continue;

					context.report({
						node,
						messageId: "restrictedFilePath",
						data: { message: restriction.message },
					});
				}
			},
		};
	},
});
