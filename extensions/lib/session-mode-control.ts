import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ModeName = "fast" | "gpt-context-1m";

export interface SessionModeControl {
  isEnabled(): boolean;
  setEnabled(enabled: boolean, ctx: ExtensionContext): void;
}

export function registerSessionMode(
  pi: ExtensionAPI,
  name: ModeName,
  control: SessionModeControl,
): void {
  pi.events.on(`session-mode:${name}:get`, (data) => {
    if (typeof data !== "object" || data === null || !("reply" in data)) return;
    if (typeof data.reply === "function") data.reply(control);
  });
}

export function getSessionMode(pi: ExtensionAPI, name: ModeName): SessionModeControl | undefined {
  let control: SessionModeControl | undefined;
  // Our listeners reply synchronously; no reply means the mode extension is not loaded.
  pi.events.emit(`session-mode:${name}:get`, {
    reply: (value: SessionModeControl) => { control = value; },
  });
  return control;
}
