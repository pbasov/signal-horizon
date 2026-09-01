/**
 * Per-tree dev ports (SD-59 / X-08). The bug being pinned: two checkouts asking for the same port,
 * which used to mean a worktree's playtest silently drove — and passed against — another tree's app.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickPort, devPort, devBase, sharedDir, ROOT, isMainCheckout } from "./workspace.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-ws-"));
  process.env.SH_STATE_DIR = dir;
  delete process.env.SH_DEV_PORT;
  delete process.env.BASE;
});
afterEach(() => {
  delete process.env.SH_STATE_DIR;
  delete process.env.SH_DEV_PORT;
  delete process.env.BASE;
  rmSync(dir, { recursive: true, force: true });
});

describe("pickPort", () => {
  it("hands the first worktree the port just above the main checkout's", () => {
    expect(pickPort({})).toBe(5174);
  });

  it("never hands out a port another live tree holds", () => {
    const live = { "/a": { port: 5174 }, "/b": { port: 5175 }, "/c": { port: 5176 } };
    expect(pickPort(live)).toBe(5177);
  });

  it("reuses the gap a removed worktree left, so the range cannot drain away", () => {
    const live = { "/a": { port: 5174 }, "/c": { port: 5176 } };
    expect(pickPort(live)).toBe(5175);
  });

  it("refuses to invent a port outside the range rather than collide", () => {
    const full = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`/t${i}`, { port: 5174 + i }]));
    expect(() => pickPort(full)).toThrow(/no free dev port/);
  });
});

describe("devPort", () => {
  it("is stable across calls — vite, the playtest and the shooter must agree without being told", () => {
    const first = devPort();
    expect(devPort()).toBe(first);
    expect(devPort()).toBe(first);
  });

  it("gives a worktree something other than the main checkout's 5173", () => {
    // This suite runs from whichever checkout invoked it; only the worktree case is interesting.
    if (isMainCheckout()) {
      expect(devPort()).toBe(5173);
    } else {
      expect(devPort()).not.toBe(5173);
      expect(devPort()).toBeGreaterThanOrEqual(5174);
    }
  });

  it("records the allocation in the shared registry, not inside the working tree", () => {
    devPort();
    if (!isMainCheckout()) expect(existsSync(join(dir, "dev-ports.json"))).toBe(true);
    expect(sharedDir().startsWith(ROOT)).toBe(false);
  });

  it("yields to SH_DEV_PORT for CI and for anyone who wants a known number", () => {
    process.env.SH_DEV_PORT = "6123";
    expect(devPort()).toBe(6123);
    expect(devBase()).toBe("http://localhost:6123");
  });

  it("yields to BASE entirely, so a tool can be pointed at a server of someone else's", () => {
    process.env.BASE = "http://localhost:9999";
    expect(devBase()).toBe("http://localhost:9999");
  });
});
