import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const setup = read("SETUP.md");
const models = read("MODELS.md");
const readme = read("README.md");

const expectedPackages = [
  "npm:pi-subagents",
  "npm:pi-web-access",
  "npm:pi-blackhole",
  "npm:pi-mem-cc",
  "npm:@narumitw/pi-btw",
  "npm:@eko24ive/pi-ask",
  "npm:pi-todo-rail",
  "npm:@99percentpeople/pi-ssh-remote",
  "npm:pi-goal-x",
  "npm:pi-ocr",
  "npm:pi-cliproxy-usage",
];

test("setup: deployment entry is Markdown, not an executable overwrite script", () => {
  for (const file of ["setup.ps1", "setup.sh"]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false);
  }
  assert.match(readme, /\[SETUP\.md\]\(SETUP\.md\)/);
  assert.match(setup, /只读盘点/);
  assert.match(setup, /提交计划并询问用户/);
  assert.match(setup, /备份将被修改的文件/);
  assert.match(setup, /保留原有资源过滤/);
  assert.match(setup, /退出管理的本机文件和包保持原样/);
  assert.match(setup, /不提交或推送仓库/);
});

test("setup: current community package list is complete and unpinned", () => {
  const section = setup.split("## 包清单\n")[1];
  assert.ok(section);
  const manifest = section.match(/```text\n([\s\S]+?)\n```/);
  assert.ok(manifest);
  const packages = manifest[1].split("\n");
  assert.deepEqual(packages, expectedPackages);
  assert.equal(new Set(packages).size, packages.length);
  for (const spec of packages) assert.match(spec, /^npm:(?:@[^/@]+\/)?[^/@]+$/);
});

test("setup: MCP, image provider and obsolete routing patch are outside the repository", () => {
  for (const file of [
    "machines/win-personal/mcp.json",
    "extensions/labyrinth-images-provider.ts",
    "vendor/pi-task-routing-patch.mjs",
  ]) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false);
  assert.match(setup, /不管理 MCP/);
  assert.match(setup, /不管理图像 provider/);
  assert.match(setup, /不得创建、复制、覆盖或删除本机的 MCP/);
  assert.match(setup, /不得同步或删除本机的/);
});

test("models: model discovery is documented without static selections in settings", () => {
  assert.equal(existsSync(new URL("../models.json", import.meta.url)), false);
  for (const file of ["settings.json", "machines/win-personal/settings.json", "machines/linux-headless/settings.json"]) {
    const settings = JSON.parse(read(file));
    for (const key of ["defaultProvider", "defaultModel", "defaultThinkingLevel", "modelThinkingLevels", "enabledModels", "pi-blackhole"]) {
      assert.equal(Object.hasOwn(settings, key), false, `${file}: ${key}`);
    }
  }
  assert.match(models, /v2\.6/);
  assert.match(models, /来源链接和核实日期/);
  assert.match(models, /上游若已发布更新系列/);
  assert.match(models, /不发送模型请求/);
  assert.match(models, /extensions\/burn\.ts/);
});

test("blackhole: staged models and ratio threshold replace the legacy single-model configuration", () => {
  const config = JSON.parse(read("pi-blackhole/pi-blackhole-config.json"));
  assert.equal(config.compactAfterRatio, 0.8);
  assert.equal(Object.hasOwn(config, "compactAfterTokens"), false);
  assert.equal(Object.hasOwn(config, "model"), false);
  for (const stage of ["observer", "reflector", "dropper"]) {
    assert.ok(config[`${stage}Model`].provider);
    assert.ok(config[`${stage}Model`].id);
    assert.ok(config[`${stage}FallbackModels`].length > 0);
  }
});

test("setup: Windows remains a single-machine configuration", () => {
  const settings = JSON.parse(read("machines/win-personal/settings.json"));
  assert.equal(settings.shellPath, "E:\\Git\\usr\\bin\\bash.exe");
  assert.deepEqual(settings.defaultTools, ["read", "powershell", "edit", "write"]);
  assert.equal(existsSync(new URL("../machines/win-personal/extensions/user-pwsh.ts", import.meta.url)), true);
});

test("security: credentials, model catalogs and runtime state are ignored, deployment resources are not", () => {
  const ignored = [
    "auth.json", "auth.json.bak", "mcp.json", "mcp-auth.json", "mcp-auth.json.bak",
    "mcp-adapter.json", "mcp-cache.json", "models.json", "models-store.json",
    "ssh-remote-config.json", "ssh-remote-known-hosts.json", "trust.json",
    "install/current-version", "sessions/example.jsonl", "memory/example.db",
    "pi-subagents/run.json", "pi-blackhole/session-pending.json",
    "pi-blackhole/pi-blackhole-cooldown.json", "extensions/herdr-agent-state.ts",
    "extensions/labyrinth-images-provider.ts", "extensions/labyrinth-images.ts",
  ];
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root, input: ignored.join("\n") + "\n", encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(new Set(result.stdout.trim().split(/\r?\n/)), new Set(ignored));
  const managed = ["SETUP.md", "MODELS.md", "settings.json", "auth.example.json", "pi-blackhole/pi-blackhole-config.json"];
  const checked = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root, input: managed.join("\n") + "\n", encoding: "utf8",
  });
  assert.equal(checked.status, 1, checked.stderr);
  assert.equal(checked.stdout, "");
});

test("docs: local Markdown links resolve to existing files", () => {
  const files = [
    "README.md", "SETUP.md", "MODELS.md", "extensions/README.md", "machines/README.md",
    "machines/win-personal/README.md", "machines/linux-personal/README.md", "machines/linux-headless/README.md",
  ];
  for (const file of files) {
    for (const match of read(file).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(existsSync(resolve(root, dirname(file), target)), `${file}: ${target}`);
    }
  }
});
