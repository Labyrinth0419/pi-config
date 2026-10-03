import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rewritePriorityServiceTierRequest(event: {
  payload?: unknown;
}): Record<string, unknown> | undefined {
  if (!isRecord(event.payload)) return undefined;

  return {
    ...event.payload,
    service_tier: "priority",
  };
}

export default function registerPriorityServiceTier(pi: ExtensionAPI) {
  pi.on("before_provider_request", rewritePriorityServiceTierRequest);
}
