import { defineConfig } from "vitest/config";

const PROTO_ROOT = "/home/basov/Games/Tauri/SignalHorizon.tauri/prototype-tauri";
// The canonical body dataset lives in the Godot tree; data/system.json here is a
// symlink to it (no copy). Vite resolves the symlink to its real path, so the
// dev server + test transform must be allowed to read outside the project root.
const GODOT_DATA = "/home/basov/Games/Godot/galaxy-link/data";

export default defineConfig({
  root: PROTO_ROOT,
  // Tauri expects a fixed dev port and quiet screen.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [PROTO_ROOT, GODOT_DATA],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
