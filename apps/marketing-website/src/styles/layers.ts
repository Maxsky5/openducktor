/**
 * The cascade layers of the site, from the lowest priority to the highest. The layout declares
 * them in the first style element of the page, so every stylesheet uses the same order.
 */
export const LAYERS = ["base", "site", "product", "replica", "views", "state"] as const;
