/**
 * Terminal escape-sequence helpers shared across extensions.
 *
 * This module lives under `extensions/lib/` (no `index.ts` / `package.json`) so
 * pi's auto-discovery skips it — it is imported by sibling extensions rather
 * than loaded as an extension itself.
 */

/**
 * Write a raw escape sequence to stdout.
 *
 * tmux only forwards unknown OSC sequences to the outer terminal when they are
 * wrapped in its DCS passthrough (\ePtmux;...\e\\) — even with
 * `allow-passthrough on`. Detect tmux via $TMUX and double-escape ESC bytes.
 *
 * Only call this when `ctx.mode === "tui"`; writing raw escapes in
 * json/rpc/print mode would corrupt the protocol stream on stdout.
 */
export function writeEscape(seq: string): void {
  if (process.env.TMUX) {
    process.stdout.write(
      `\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`,
    );
  } else {
    process.stdout.write(seq);
  }
}
