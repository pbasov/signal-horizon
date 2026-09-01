/**
 * The cross-worktree mutex (SD-59 / X-08). The properties that matter are not "it makes a file":
 * they are that a SECOND holder is impossible, that a DEAD holder never wedges the repo, and that a
 * process reaped as stale cannot delete the lock its successor now owns.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-lock-"));
  process.env.SH_STATE_DIR = dir;
  delete process.env.SH_NO_LOCK;
});
afterEach(() => {
  delete process.env.SH_STATE_DIR;
  delete process.env.SH_NO_LOCK;
  rmSync(dir, { recursive: true, force: true });
});

const lockFile = () => join(dir, "t.lock");
const load = () => import("./lock.mjs");

describe("acquire", () => {
  it("grants the lock and writes a holder record naming this process", async () => {
    const { acquire } = await load();
    const h = await acquire("t", { what: "unit test" });
    const rec = JSON.parse(readFileSync(lockFile(), "utf8"));
    expect(rec.pid).toBe(process.pid);
    expect(rec.what).toBe("unit test");
    h.release();
    expect(existsSync(lockFile())).toBe(false);
  });

  it("refuses a second holder while a live one holds it", async () => {
    const { acquire } = await load();
    const h = await acquire("t", {});
    // A live foreign holder: our own pid is provably alive, so it cannot be reaped as dead.
    writeFileSync(lockFile(), JSON.stringify({ token: "someone-else", pid: process.pid, tree: "neighbour", at: Date.now() }));
    await expect(acquire("t", { timeoutMs: 300, log: () => {} })).rejects.toThrow(/held by neighbour/);
    h.release();
  });

  it("reaps a holder whose process is gone", async () => {
    const { acquire } = await load();
    // A pid that cannot exist: kill(0) throws ESRCH, so the holder is dead, so the lock is free.
    writeFileSync(lockFile(), JSON.stringify({ token: "ghost", pid: 0x7ffffff0, tree: "crashed", at: Date.now() }));
    const h = await acquire("t", { timeoutMs: 300 });
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).pid).toBe(process.pid);
    h.release();
  });

  it("reaps a holder older than the stale window even if its process lives", async () => {
    const { acquire } = await load();
    writeFileSync(lockFile(), JSON.stringify({ token: "wedged", pid: process.pid, tree: "wedged", at: Date.now() - 60000 }));
    const h = await acquire("t", { timeoutMs: 300, staleMs: 1000 });
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).not.toBe("wedged");
    h.release();
  });

  it("treats a corrupt lock file as reapable rather than jamming forever", async () => {
    const { acquire } = await load();
    writeFileSync(lockFile(), "{ this is not json");
    const h = await acquire("t", { timeoutMs: 300 });
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).pid).toBe(process.pid);
    h.release();
  });

  it("never deletes a lock that has been taken over by someone else", async () => {
    const { acquire } = await load();
    const h = await acquire("t", {});
    // Simulate: we were reaped as stale mid-run and a neighbour took the lock.
    writeFileSync(lockFile(), JSON.stringify({ token: "successor", pid: process.pid, tree: "next", at: Date.now() }));
    h.release();
    expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe("successor");
  });

  it("is a no-op under SH_NO_LOCK=1, for someone who knows they are alone", async () => {
    process.env.SH_NO_LOCK = "1";
    const { acquire } = await load();
    const a = await acquire("t", {});
    const b = await acquire("t", { timeoutMs: 300 });
    expect(existsSync(lockFile())).toBe(false);
    a.release();
    b.release();
  });
});

describe("withLock", () => {
  it("releases even when the body throws", async () => {
    const { withLock, acquire } = await load();
    await expect(withLock("t", {}, async () => {
      throw new Error("scene exploded");
    })).rejects.toThrow("scene exploded");
    const h = await acquire("t", { timeoutMs: 300 });
    h.release();
  });
});
