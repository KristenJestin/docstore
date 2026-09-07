import { z } from "zod";

/**
 * Boolean tool input that also accepts `"true"` and `"false"`.
 *
 * MCP arguments travel as JSON, but a fair number of clients build them from a
 * text template and send every scalar as a string. A `z.boolean()` then rejects
 * `"true"` outright, and the agent reads a validation error on an argument it
 * believes it passed correctly — with no way to tell, from the schema, that the
 * quotes were the problem.
 *
 * The JSON Schema published by `tools/list` is unchanged: `z.preprocess` sits
 * on the input side of a pipe whose declared type is still `boolean`, so
 * clients keep being told to send a real boolean. This only widens what the
 * server accepts, it never advertises the string form as the right one.
 */
export const mcpBoolean = z.preprocess((value) => {
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}, z.boolean());
