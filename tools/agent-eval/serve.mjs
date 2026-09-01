/**
 * Moved to tools/serve.mjs (SD-59 / X-08) — the "never share a dev server" rule is not the
 * agent-eval harness's alone: the playtest, the smoke check and the screenshot tools all need it.
 * Re-exported here so this module's importers keep working.
 */
export { startServer, portFor, isServing, ensureServer } from "../serve.mjs";
