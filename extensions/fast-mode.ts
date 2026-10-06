import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { registerSessionMode } from "./lib/session-mode-control.ts";

const STATUS_KEY = "fast-tier";
const FLAG = "fast";
const STATE_TYPE = "fast-mode-state";

function hasGptName(model: Model<any> | undefined): boolean {
  return !!model && /gpt/i.test(`${model.id} ${model.name ?? ""}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function (pi: ExtensionAPI) {
  let active = false;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(
      STATUS_KEY,
      active ? ctx.ui.theme.fg("accent", "⚡ fast on") : undefined,
    );
  };

  const setEnabled = (enabled: boolean, ctx: ExtensionContext) => {
    pi.appendEntry(STATE_TYPE, { enabled });
    active = enabled;
    updateStatus(ctx);
  };

  registerSessionMode(pi, "fast", { isEnabled: () => active, setEnabled });

  const restoreState = (ctx: ExtensionContext): boolean => {
    active = pi.getFlag(FLAG) === true;
    let found = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      if (isRecord(entry.data) && typeof entry.data.enabled === "boolean") {
        active = entry.data.enabled;
        found = true;
      }
    }
    updateStatus(ctx);
    return found;
  };

  const notifyStatus = (ctx: ExtensionContext) => {
    if (!hasGptName(ctx.model)) {
      ctx.ui.notify(
        `Fast is ${active ? "on" : "off"}; it applies to models whose name or ID contains "gpt".`,
        "info",
      );
      return;
    }
    ctx.ui.notify(
      `Fast is ${active ? "on" : "off"} for ${ctx.model?.provider}/${ctx.model?.id}. ${active ? "Pi will best-effort add service_tier=priority to provider requests." : "No priority parameter will be added."}`,
      "info",
    );
  };

  pi.registerFlag(FLAG, {
    description: "Best-effort priority tier for models with GPT in their name or ID",
    type: "boolean",
    default: false,
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!active || !hasGptName(ctx.model) || !isRecord(event.payload)) return;
    return { ...event.payload, service_tier: "priority" };
  });

  pi.registerCommand("fast", {
    description: "Toggle best-effort priority tier for GPT-named models",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("用法：/fast（不带参数，切换开关）。", "error");
        return;
      }
      setEnabled(!active, ctx);
      notifyStatus(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!restoreState(ctx)) {
      // Pin the initial --fast/default value so resuming needs no matching CLI flag.
      pi.appendEntry(STATE_TYPE, { enabled: active });
    }
  });
  pi.on("session_tree", async (_event, ctx) => { restoreState(ctx); });
  pi.on("model_select", async (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", async (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));
}
