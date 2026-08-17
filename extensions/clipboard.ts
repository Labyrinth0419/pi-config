/**
 * Clipboard Extension
 *
 * Provides a tool that allows the LLM to copy text to the user's clipboard
 * using OSC52 escape sequences. This works across SSH sessions and most
 * modern terminal emulators.
 *
 * Usage:
 *   Ask the LLM: "write me a draft reply and put it into clipboard!"
 */
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { writeEscape } from "./lib/term";

/**
 * Encode text to base64 for OSC52
 */
function toBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

/**
 * Copy text to clipboard using the OSC52 escape sequence.
 *
 * OSC52 is supported by most modern terminal emulators including iTerm2, Kitty,
 * Alacritty, WezTerm, foot, and Windows Terminal. Under tmux the sequence is
 * wrapped in a DCS passthrough (handled by `writeEscape`).
 *
 * Must only be called in interactive TUI mode — raw escapes on stdout would
 * corrupt the protocol stream used by json/rpc/print modes.
 */
function copyToClipboard(text: string): void {
  const base64Text = toBase64(text);
  // OSC 52 ; c ; <base64-text> ST
  // \x1b] = OSC (Operating System Command)
  // 52   = clipboard operation
  // c    = clipboard selection (could also be p for primary, s for secondary)
  // \x07 = ST (String Terminator) — \x1b\\ also works
  writeEscape(`\x1b]52;c;${base64Text}\x07`);
}

export default function clipboardExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "copy_to_clipboard",
    label: "Copy to Clipboard",
    description:
      "Copy text to the user's system clipboard. Use this when the user asks you to " +
      "put something in their clipboard, write a draft reply to clipboard, or copy any " +
      "generated text for easy pasting. The text will be available for pasting immediately.",
    parameters: Type.Object({
      text: Type.String({
        description: "The text to copy to the clipboard",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { text } = params as { text: string };

      // Reject empty/whitespace-only input as a real error so the LLM retries,
      // rather than returning a success-shaped result that merely says "error".
      // (Returning a value never sets isError — only throwing does.)
      if (!text || text.trim().length === 0) {
        throw new Error("No non-empty text provided to copy.");
      }

      // OSC52 only works in interactive TUI mode. Writing raw escapes in
      // json/print/rpc mode would corrupt the protocol stream on stdout.
      if (ctx.mode !== "tui") {
        throw new Error(
          `copy_to_clipboard is only available in interactive TUI mode (current: "${ctx.mode}").`,
        );
      }

      copyToClipboard(text);

      // Count by code points (not UTF-16 code units) so emoji/CJK counts are
      // not inflated, and slice the preview on the same boundary to avoid
      // splitting surrogate pairs.
      const codePoints = [...text];
      const byteCount = Buffer.byteLength(text, "utf-8");
      const preview =
        codePoints.length > 100
          ? `${codePoints.slice(0, 100).join("")}...`
          : text;

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Copied ${codePoints.length} characters to clipboard`,
          "info",
        );
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Successfully copied ${codePoints.length} characters (${byteCount} bytes) to clipboard.\n\n` +
              `Preview:\n${preview}`,
          },
        ],
        details: {
          success: true,
          characterCount: codePoints.length,
          byteCount,
          preview,
        },
      };
    },
  });
}
