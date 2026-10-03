import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantImages, AuthContext, ImageModel, ImagesContext, ImagesOptions, Provider, Usage } from "@earendil-works/pi-ai";

const agentDir = join(homedir(), ".pi", "agent");
const imageDir = join(homedir(), "Pictures", "Pi-Generated-Images");
const providerId = "labyrinth-images";
const imageApi = "labyrinth-openai-images";
const outputRate = 30;
const imageIds = [
  ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
  ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
] as const;

async function labyrinthKey(ctx: AuthContext): Promise<string | undefined> {
  try {
    const auth = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
    if (auth.labyrinth?.type === "api_key" && typeof auth.labyrinth.key === "string" && auth.labyrinth.key) {
      return auth.labyrinth.key;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return ctx.env("LABYRINTH_API_KEY");
}

function imageFormat(data: Buffer): { extension: string; mimeType: string } {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (data[0] === 0xff && data[1] === 0xd8) return { extension: "jpg", mimeType: "image/jpeg" };
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", mimeType: "image/webp" };
  }
  throw new Error("Unsupported image format");
}

/** Save image blocks without discarding a successful generation on disk errors. */
export async function saveGeneratedImages(result: AssistantImages, directory: string): Promise<void> {
  for (const block of [...result.output]) {
    if (block.type !== "image") continue;
    try {
      const data = Buffer.from(block.data, "base64");
      const format = imageFormat(data);
      const stamp = new Date(result.timestamp).toISOString().replace(/[:.]/g, "-");
      const model = result.model.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = join(directory, `${stamp}-${model}-${randomUUID()}.${format.extension}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path, data, { flag: "wx" });
      block.mimeType = format.mimeType;
      result.output.push({ type: "text", text: `Saved image to: ${path}` });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.output.push({ type: "text", text: `Image generated but could not be saved: ${reason}` });
    }
  }
}

async function generateImages(model: ImageModel<string>, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages> {
  const result: AssistantImages = {
    api: model.api, provider: model.provider, model: model.id,
    output: [], stopReason: "stop", timestamp: Date.now(),
  };
  try {
    if (!options?.apiKey) throw new Error("Labyrinth API key is unavailable");
    const prompt = context.input.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const references = context.input.filter((item) => item.type === "image");
    if (!prompt) throw new Error("A text prompt is required");
    const edit = references.length > 0;
    let payload: FormData | { model: string; prompt: string; n: number };
    if (edit) {
      const form = new FormData();
      form.set("model", model.id);
      form.set("prompt", prompt);
      for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const suffix = ref.mimeType === "image/jpeg" ? "jpg" : ref.mimeType === "image/webp" ? "webp" : "png";
        form.append("image[]", new Blob([Buffer.from(ref.data, "base64")], { type: ref.mimeType }), `reference-${i}.${suffix}`);
      }
      payload = form;
    } else {
      payload = { model: model.id, prompt, n: 1 };
    }
    const outgoing = (await options.onPayload?.(payload, model)) ?? payload;
    const response = await (options.fetch ?? fetch)(`${model.baseUrl.replace(/\/$/, "")}/images/${edit ? "edits" : "generations"}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...model.headers, ...options.headers,
        ...(!edit ? { "Content-Type": "application/json" } : {}),
      },
      body: edit ? outgoing as FormData : JSON.stringify(outgoing),
      signal: options.signal,
    });
    await options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers) }, model);
    if (!response.ok) throw new Error(`Labyrinth Images API returned HTTP ${response.status}`);
    const body = await response.json() as {
      data?: Array<{ b64_json?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
    };
    for (const item of body.data ?? []) {
      if (item.b64_json) result.output.push({ type: "image", data: item.b64_json, mimeType: "image/png" });
    }
    if (!result.output.length) throw new Error("Images API returned no base64 image");
    await saveGeneratedImages(result, imageDir);
    if (body.usage) {
      const input = body.usage.input_tokens ?? 0;
      const output = body.usage.output_tokens ?? 0;
      const text = body.usage.input_tokens_details?.text_tokens ?? input;
      const image = body.usage.input_tokens_details?.image_tokens ?? 0;
      const inputCost = (text * 5 + image * 8) / 1e6;
      const outputCost = output * outputRate / 1e6;
      result.usage = {
        input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
        cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0, total: inputCost + outputCost },
      } satisfies Usage;
    }
  } catch (error) {
    result.stopReason = options?.signal?.aborted ? "aborted" : "error";
    result.errorMessage = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export default async function (pi: ExtensionAPI) {
  const config = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
  const baseUrl = config.providers?.labyrinth?.baseUrl;
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    throw new Error("Labyrinth baseUrl is missing from models.json");
  }
  const models: ImageModel<string>[] = imageIds.map(([id, name]) => ({
    type: "image", id, name, provider: providerId, api: imageApi, baseUrl,
    input: ["text", "image"], output: ["image"],
    cost: { input: 5, output: outputRate, cacheRead: 0, cacheWrite: 0 },
  }));
  const provider: Provider = {
    id: providerId, name: "Labyrinth Images", baseUrl,
    auth: { apiKey: {
      name: "Labyrinth API key",
      check: async ({ ctx }) => (await labyrinthKey(ctx)) ? { type: "api_key", source: "labyrinth" } : undefined,
      resolve: async ({ ctx }) => {
        const key = await labyrinthKey(ctx);
        return key ? { auth: { apiKey: key }, source: "labyrinth" } : undefined;
      },
    } },
    getModels: () => [],
    getAllModels: () => models,
    stream: () => { throw new Error("Image-only provider"); },
    streamSimple: () => { throw new Error("Image-only provider"); },
    generateImages,
  };
  pi.registerProvider(provider);
}
