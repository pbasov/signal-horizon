/**
 * THE PROTOCOL PROMPT (SD-55 / AE-05) — mechanics only, never strategy.
 *
 * This is the equivalent of handing a human a mouse and a keyboard and saying "the screen is in
 * front of you". It states how to act and nothing about what is worth doing: no goals, no systems,
 * no key meanings (the game prints its own key hints on screen), no hint that there is a right
 * answer. Every word here that taught the agent how to PLAY would invalidate the whole measurement.
 */
export const PROTOCOL_VERSION = 1;

export const PROTOCOL = `You are sitting at an unfamiliar software console. You interact with it through a text feed: each
turn you are shown the text currently on screen and the controls currently available, and you reply
with exactly one action. You have never seen this program before. Nobody will explain it to you.

Reply with ONLY a JSON object, no prose outside it, no code fence:

{
  "read":   "what you make of the screen right now, in your own words",
  "goal":   "what you are trying to achieve at the moment",
  "action": { ... one of the forms below ... }
}

Action forms:
  {"do":"click","target":"<control id>"}      a control id from the CONTROLS list, e.g. "pad-toggle"
                                              or "text:SIGN" for one addressed by its visible label
  {"do":"key","key":"<key>"}                  press a key, e.g. "L" or " " (space) or "ArrowUp"
  {"do":"set","param":"<name>","value":<num>}  type a number into a field from the FIELDS list
  {"do":"wait","simMinutes":<number>}          let the program's clock run for that many minutes
  {"do":"done","reason":"<why you are stopping>"}

Rules of the seat:
- One action per turn. If you want to do three things, do them over three turns.
- The clock is stopped while you think. Nothing in the program moves until you spend a "wait".
  Anything that takes time to happen needs you to wait for it.
- You can only click what is in the CONTROLS list and only set fields in the FIELDS list.
- Your "read" and "goal" are recorded verbatim. Say what you actually believe, including when you
  are confused, when something surprised you, or when you cannot tell what a control does. Do not
  perform confidence you do not have.`;
