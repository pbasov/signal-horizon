/**
 * Loads the canonical body definitions from data/system.json — a vendored copy
 * of the Godot project's dataset, kept as a real file in this repo so the
 * project is self-contained (no symlink into an external tree). Vite/Vitest
 * resolve the JSON import at build time via resolveJsonModule. If the Godot
 * dataset changes, re-copy data/system.json to keep the two in sync.
 */
import systemRaw from "../../data/system.json";
import { Ephemeris, type SystemSpec } from "./ephemeris";

export const SYSTEM = systemRaw as unknown as SystemSpec;

/** Build a fresh Ephemeris from the canonical dataset. */
export function loadEphemeris(): Ephemeris {
  return Ephemeris.build(SYSTEM);
}
