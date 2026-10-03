import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLocalPowerShellOperations } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("user_bash", () => ({
    operations: createLocalPowerShellOperations(),
  }));
}
