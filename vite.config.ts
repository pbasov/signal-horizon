import { defineConfig } from "vitest/config";

// Root is left implicit so it defaults to the cwd — i.e. this directory, since
// `npm run {dev,build,preview}` always run from the package root. This keeps the
// config portable: no absolute paths, works wherever the repo is cloned. The
// body dataset (data/system.json) is a real file inside the root, so no
// cross-tree `server.fs.allow` widening is needed.
export default defineConfig({
  // Tauri expects a fixed dev port and quiet screen.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // A concurrent agent session creating a git worktree under .claude/worktrees/ dropped a second
      // index.html + tsconfig.json inside this root, and vite answered with
      //   "changed tsconfig file detected … forcing full-reload"
      // which re-booted the page of whoever was playing on :5173. It cost an agent-eval run its
      // second half mid-flight (the sim reset to boot, wallet back to €75,000) and would cost a human
      // playtester their session just as silently. Worktrees are not part of this app's module graph;
      // neither are harness artifacts.
      ignored: ["**/.claude/worktrees/**", "**/tools/agent-eval/runs/**", "**/docs/screenshots/**"],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    // src/ is the sim + shell. tools/ carries the harness's pure logic (the agent-eval metric
    // extractor, SD-55 AE-04) — pure functions over an action log, tested like any sim module.
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
    // The replay/golden suites (net-replay, events) simulate whole sessions tick-by-tick; under
    // full-suite CPU contention they legitimately need tens of seconds. The default 5 s was a
    // recurring flake (three false-reds in one day) — 60 s keeps real hangs visible.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
