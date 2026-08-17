#!/usr/bin/env bash
# pi-config setup — Linux (个人机 / 无头服务器) 与 Git Bash on Windows 通用
# 用法:  ./setup.sh            # 自动检测机器
#        PI_MACHINE=linux-headless ./setup.sh   # 或显式指定
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

# --- 机器检测 ---------------------------------------------------------------
detect_machine() {
  [ -n "${PI_MACHINE:-}" ] && { echo "$PI_MACHINE"; return; }
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "win-personal"; return ;;
  esac
  # Linux: 无显示 + (SSH 或非交互) => 无头服务器
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && \
     { [ -n "${SSH_TTY:-}" ] || [ -n "${SSH_CONNECTION:-}" ] || [ ! -t 0 ]; }; then
    echo "linux-headless"
  else
    echo "linux-personal"
  fi
}
MACHINE="$(detect_machine)"
echo "==> machine overlay: $MACHINE"

# --- 核心配置同步 -----------------------------------------------------------
mkdir -p "$PI_DIR"
for f in AGENTS.md settings.json models.json keybindings.json; do
  cp -f "$REPO/$f" "$PI_DIR/$f"
  echo "  + $f"
done
for d in extensions skills prompts; do
  mkdir -p "$PI_DIR/$d"
  cp -rf "$REPO/$d/." "$PI_DIR/$d/"
  echo "  + $d/"
done

# --- 机器覆盖层 -------------------------------------------------------------
M_DIR="$REPO/machines/$MACHINE"
for f in settings.json mcp.json; do
  if [ -f "$M_DIR/$f" ]; then
    cp -f "$M_DIR/$f" "$PI_DIR/$f"
    echo "  + machines/$MACHINE/$f (overlay)"
  fi
done
if [ -d "$M_DIR/extensions" ]; then
  mkdir -p "$PI_DIR/extensions"
  cp -rf "$M_DIR/extensions/." "$PI_DIR/extensions/"
  echo "  + machines/$MACHINE/extensions/ (overlay)"
fi

# --- auth.json --------------------------------------------------------------
# 已存在且含非空 key 则保留;否则尝试从 ~/.claude / ~/.codex 提取;都没有则用模板
has_keys() { [ -s "$PI_DIR/auth.json" ] && ! grep -q '""' "$PI_DIR/auth.json"; }
if has_keys; then
  echo "==> auth.json exists with keys, keeping"
else
  if command -v node >/dev/null 2>&1; then
    PI_DIR="$PI_DIR" node -e '
      const fs=require("fs"), os=require("os"), path=require("path");
      const home=os.homedir(), out={};
      try {
        const c=JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
        if (c.env && c.env.ANTHROPIC_AUTH_TOKEN) out.deepseek={type:"api_key", key:c.env.ANTHROPIC_AUTH_TOKEN};
      } catch(e){}
      try {
        const c=JSON.parse(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8"));
        if (c.OPENAI_API_KEY) out.lucen={type:"api_key", key:c.OPENAI_API_KEY};
      } catch(e){}
      if (Object.keys(out).length) {
        fs.writeFileSync(path.join(process.env.PI_DIR, "auth.json"), JSON.stringify(out, null, 2));
      }
    ' >/dev/null 2>&1 || true
  fi
  if has_keys; then
    echo "==> auth.json written from ~/.claude + ~/.codex"
  else
    cp -f "$REPO/auth.example.json" "$PI_DIR/auth.json"
    echo "==> auth.json = example (empty) — fill keys or run: pi /login"
  fi
fi

# --- 核心扩展 ---------------------------------------------------------------
if command -v pi >/dev/null 2>&1; then
  echo "==> ensuring core extensions"
  for p in pi-subagents pi-mcp-adapter pi-web-access pi-blackhole pi-background-tasks; do
    if pi install "npm:$p" >/dev/null 2>&1; then
      echo "  + npm:$p"
    else
      echo "  ! npm:$p failed (maybe already latest)"
    fi
  done
else
  echo "!! pi not found on PATH — install pi first, then re-run setup"
fi

echo "==> done. verify with: pi --version && pi list"
