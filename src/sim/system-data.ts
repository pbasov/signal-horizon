/**
 * Loads the canonical body definitions from data/system.json — the SAME file as
 * the Godot project (prototype-tauri/data/system.json is a symlink to it, no
 * copy). Vite/Vitest resolve the JSON import through the symlink; see
 * vite.config.ts `server.fs.allow` for the cross-tree allowance.
 */
import systemRaw from "../../data/system.json";
import { Ephemeris, type SystemSpec } from "./ephemeris";

export const SYSTEM = systemRaw as unknown as SystemSpec;

/** Build a fresh Ephemeris from the canonical dataset. */
export function loadEphemeris(): Ephemeris {
  return Ephemeris.build(SYSTEM);
}
