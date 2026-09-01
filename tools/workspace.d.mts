/**
 * Types for tools/workspace.mjs — needed because vite.config.ts imports it, and `npm run build`
 * typechecks the config. The harness stays plain ESM (it runs under bare `node`, no build step);
 * this file is the seam where it meets the typed side.
 */

/** This checkout's root directory. */
export declare const ROOT: string;

/** Cross-worktree state directory (inside the main repo's .git; never inside a working tree). */
export declare function sharedDir(): string;

/** True when this is the primary checkout rather than a worktree under .claude/worktrees/. */
export declare function isMainCheckout(): boolean;

/** Human-readable name for this checkout, used in lock records and log lines. */
export declare function treeName(): string;

/** This checkout's dev-server port: 5173 for the main tree, an owned port for each worktree. */
export declare function devPort(): number;

/** The lowest port in the worktree range that no live tree holds. */
export declare function pickPort(live: Record<string, { port: number }>): number;

/** The base URL this checkout's tools should talk to unless BASE says otherwise. */
export declare function devBase(): string;
