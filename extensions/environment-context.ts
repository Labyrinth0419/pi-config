/**
 * Environment Context Extension
 *
 * Injects dynamic environment information into the system prompt so the LLM
 * knows CWD, user identity, Git status, Nix/devenv configuration, and OS
 * details before generating commands. Prevents wrong assumptions about paths,
 * package managers, and project structure.
 *
 * Hooks `before_agent_start` to gather environment state and append it as a
 * structured "Environment" section to the system prompt. Caches results per
 * session to avoid redundant subprocess calls.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const execAsync = promisify(execCb);

// ── Types ──────────────────────────────────────────────────────────────────

interface EnvSnapshot {
  cwd: string;
  user: string;
  home: string;
  hostname: string;
  os: string;
  shell: string;
  git?: GitInfo;
  nix?: NixInfo;
  projectKind?: string[];
}

interface GitInfo {
  branch: string;
  dirty: boolean;
  remote?: string;
}

interface NixInfo {
  isNixOS: boolean;
  hasFlake: boolean;
  hasShellNix: boolean;
  hasDirenv: boolean;
  direnvStatus: "on" | "blocked" | "error" | "off" | "pending" | null;
  inNixShell: boolean;
}

// ── Cache ───────────────────────────────────────────────────────────────────

let cachedSnapshot: EnvSnapshot | null = null;
let cachedCwd = "";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function exec(cwd: string, cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 3000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

// ── Collectors ──────────────────────────────────────────────────────────────

function collectStaticEnv(): Pick<
  EnvSnapshot,
  "cwd" | "user" | "home" | "hostname" | "os" | "shell"
> {
  return {
    cwd: process.cwd(),
    user: process.env.USER || process.env.LOGNAME || "unknown",
    home: process.env.HOME || homedir(),
    hostname: process.env.HOSTNAME || process.env.HOST || "unknown",
    os: `${process.platform} ${process.arch}`,
    shell: process.env.SHELL || "unknown",
  };
}

async function collectGitInfo(cwd: string): Promise<GitInfo | undefined> {
  // Quick check: is there a .git directory?
  if (!fileExists(join(cwd, ".git"))) {
    // Could be a worktree; check if git rev-parse works
    const inside = await exec(
      cwd,
      "git rev-parse --git-dir 2>/dev/null || echo ''",
    );
    if (!inside) return undefined;
  }

  const branch = await exec(
    cwd,
    "git branch --show-current 2>/dev/null || echo ''",
  );
  const status = await exec(cwd, "git status --porcelain 2>/dev/null");
  const remote = await exec(
    cwd,
    "git remote get-url origin 2>/dev/null || echo ''",
  );

  if (!branch) return undefined; // Not a git repo or no commits yet

  const dirty = status.length > 0;

  return {
    branch,
    dirty,
    ...(remote ? { remote } : {}),
  };
}

async function collectNixInfo(cwd: string): Promise<NixInfo | undefined> {
  const hasFlake = fileExists(join(cwd, "flake.nix"));
  const hasShellNix = fileExists(join(cwd, "shell.nix"));
  const hasDirenv = fileExists(join(cwd, ".envrc"));

  // Read direnv runtime status set by direnv.ts extension (may not be set yet).
  const direnvStatus =
    (process.env.PI_DIRENV_STATUS as NixInfo["direnvStatus"]) ?? null;

  // Check if we're on NixOS
  let isNixOS = false;
  const osRelease = await exec(
    cwd,
    "cat /etc/os-release 2>/dev/null || echo ''",
  );
  isNixOS = osRelease.includes("nixos") || osRelease.includes("NixOS");

  // Check if in a nix shell
  const inNixShell =
    !!process.env.IN_NIX_SHELL ||
    !!process.env.NIX_BUILD_TOP ||
    !!process.env.NIX_STORE;

  if (!hasFlake && !hasShellNix && !hasDirenv && !isNixOS && !inNixShell) {
    return undefined;
  }

  return {
    isNixOS,
    hasFlake,
    hasShellNix,
    hasDirenv,
    direnvStatus,
    inNixShell,
  };
}

function detectProjectKind(cwd: string): string[] {
  const markers: [string, string][] = [
    ["flake.nix", "Nix flake"],
    ["shell.nix", "Nix shell"],
    ["package.json", "Node.js"],
    ["Cargo.toml", "Rust"],
    ["go.mod", "Go"],
    ["pyproject.toml", "Python"],
    ["setup.py", "Python"],
    ["Cargo.lock", "Rust"],
    ["Makefile", "Make"],
    ["CMakeLists.txt", "CMake"],
    ["meson.build", "Meson"],
    ["BUILD", "Bazel"],
    ["Gemfile", "Ruby"],
    ["pom.xml", "Maven"],
    ["build.gradle", "Gradle"],
    ["deno.json", "Deno"],
    ["tsconfig.json", "TypeScript"],
  ];

  return markers
    .filter(([file]) => fileExists(join(cwd, file)))
    .map(([, label]) => label);
}

// ── Snapshot ────────────────────────────────────────────────────────────────

async function takeSnapshot(): Promise<EnvSnapshot> {
  const cwd = process.cwd();
  const staticEnv = collectStaticEnv();

  // Only re-run git/nix checks if CWD changed
  if (cachedSnapshot && cachedCwd === cwd) {
    return {
      ...staticEnv,
      git: cachedSnapshot.git,
      nix: cachedSnapshot.nix,
      projectKind: cachedSnapshot.projectKind,
    };
  }

  const [git, nix] = await Promise.all([
    collectGitInfo(cwd),
    collectNixInfo(cwd),
  ]);

  const projectKind = detectProjectKind(cwd);

  cachedSnapshot = { ...staticEnv, git, nix, projectKind };
  cachedCwd = cwd;

  return cachedSnapshot;
}

// ── Formatter ───────────────────────────────────────────────────────────────

function formatSnapshot(snap: EnvSnapshot): string {
  const lines: string[] = [];

  lines.push("## Environment");
  lines.push("");
  lines.push(`- **CWD:** \`${snap.cwd}\``);
  lines.push(`- **User:** \`${snap.user}\` (home: \`${snap.home}\`)`);
  lines.push(`- **Host:** \`${snap.hostname}\` (${snap.os})`);
  lines.push(`- **Shell:** \`${snap.shell}\``);

  // Git
  if (snap.git) {
    const dirty = snap.git.dirty ? " (DIRTY)" : "";
    const remote = snap.git.remote ? `, remote: \`${snap.git.remote}\`` : "";
    lines.push(`- **Git:** branch=\`${snap.git.branch}\`${dirty}${remote}`);
  }

  // Nix
  if (snap.nix) {
    const parts: string[] = [];
    if (snap.nix.isNixOS) parts.push("NixOS");
    if (snap.nix.hasFlake) parts.push("flake.nix present");
    if (snap.nix.hasShellNix) parts.push("shell.nix present");
    if (snap.nix.hasDirenv) {
      const statusLabel = snap.nix.direnvStatus
        ? {
            on: "active",
            blocked: "blocked",
            error: "error",
            off: "no vars",
            pending: "pending",
          }[snap.nix.direnvStatus]
        : "pending";
      parts.push(`direnv (.envrc, ${statusLabel})`);
    }
    if (snap.nix.inNixShell) parts.push("currently in nix shell");
    if (parts.length > 0) {
      lines.push(`- **Nix:** ${parts.join(", ")}`);
    }
  }

  // Project kind
  if (snap.projectKind && snap.projectKind.length > 0) {
    lines.push(`- **Project type:** ${snap.projectKind.join(", ")}`);
  }

  return lines.join("\n");
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function environmentContext(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const snap = await takeSnapshot();
    const envSection = formatSnapshot(snap);

    // Prepend environment section near the top of the system prompt so it's
    // prominent. This avoids wrong assumptions about paths, package managers,
    // and project structure.
    const splitMarker = "# Project Context";
    const currentPrompt = event.systemPrompt;
    const hasEnvSection = currentPrompt.includes("## Environment");

    let newPrompt: string;
    if (hasEnvSection) {
      // Replace existing environment section (from previous turns)
      newPrompt = currentPrompt.replace(
        /## Environment\n[\s\S]*?(?=\n## |\n# |$)/,
        envSection,
      );
    } else if (currentPrompt.includes(splitMarker)) {
      // Insert after "# Project Context" header
      newPrompt = currentPrompt.replace(
        splitMarker,
        `${splitMarker}\n\n${envSection}`,
      );
    } else {
      // Append at end
      newPrompt = `${currentPrompt}\n\n${envSection}`;
    }

    return { systemPrompt: newPrompt };
  });

  // Clear cache on reload
  pi.on("session_shutdown", () => {
    cachedSnapshot = null;
    cachedCwd = "";
  });
}
