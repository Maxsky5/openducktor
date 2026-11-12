/** The attribute of the page root that keeps a search tap from before the page responds to input. */
export const SEARCH_TAP = "data-search-tap";

/**
 * Runs in the head, before the page responds to input. A tap on a search button marks the page
 * root, and the provider opens search when the page hydrates, so a tap on a slow phone is not lost.
 */
export const SEARCH_TAP_SCRIPT = `document.addEventListener("click",e=>{const r=document.documentElement;if(!r.hasAttribute("data-hydrated")&&e.target instanceof Element&&e.target.closest("[data-search],[data-search-full]"))r.setAttribute(${JSON.stringify(SEARCH_TAP)},"")},true)`;
