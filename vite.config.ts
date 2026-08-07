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
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The replay/golden suites (net-replay, events) simulate whole sessions tick-by-tick; under
    // full-suite CPU contention they legitimately need tens of seconds. The default 5 s was a
    // recurring flake (three false-reds in one day) — 60 s keeps real hangs visible.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
