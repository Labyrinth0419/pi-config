import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

const STATUS_KEY = "fast-tier";
const FLAG = "fast";

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
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off", "status"];
      return values
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (command === "status") {
        updateStatus(ctx);
        notifyStatus(ctx);
        return;
      }
      if (command === "on" || command === "off" || command === "") {
        active = command === "on" || (command === "" && !active);
        updateStatus(ctx);
        notifyStatus(ctx);
        return;
      }
      ctx.ui.notify("Usage: /fast [on|off|status]", "error");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    active = pi.getFlag(FLAG) === true;
    updateStatus(ctx);
  });
  pi.on("model_select", async (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", async (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));
}
