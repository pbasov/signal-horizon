/**
 * THE SCRIPTED CEILING (SD-55 / AE-08).
 *
 * Expert play WITH foreknowledge, pushed through the same driver loop as the agent so every metric
 * is comparable by construction instead of by assertion (docs/agent-eval.md §5). It is the same
 * golden path the authored scene `tools/scenes/act1.mjs` asserts — aim the parked draft home, arm,
 * launch, let it fly, sign, then hold and let the term run.
 *
 * This is a CEILING on the behavioural metrics, not a target. It knows the answer; the agent does
 * not, and a human novice does not either.
 */

/** One action per turn, in order. Anything past the end holds position. */
export const SCRIPTED_ACT1 = [
  { do: "click", target: "pad-toggle" }, //  open the pad
  { do: "set", param: "subLonDeg", value: 0 }, //  the seeded draft parks 90° west of the target
  { do: "click", target: "arm" },
  { do: "click", target: "launch" },
  { do: "wait", simMinutes: 2 }, //  ascent + deploy + first acquisition
  { do: "click", target: "accept" }, //  sign only once the bird is actually up
  { do: "wait", simMinutes: 5 },
  { do: "wait", simMinutes: 10 }, //  two dwell lengths: tempo counts as a real choice
  { do: "wait", simMinutes: 10 },
  { do: "wait", simMinutes: 10 },
];

export function scriptedPolicy(turnIndex) {
  const step = SCRIPTED_ACT1[turnIndex] ?? { do: "wait", simMinutes: 10 };
  return { read: "(scripted ceiling — plays the known act-1 path)", goal: "(scripted ceiling)", action: step };
}
