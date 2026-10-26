import { z } from "zod";

// Zod builds a parser for each object schema with `new Function` at its first parse. Hermes
// compiles that source at run time, so the first live event of each kind blocks JavaScript.
// A schema reads this flag when it is created, so this module loads before any schema module.
z.config({ jitless: true });
