#!/usr/bin/env bash
# pi-config setup (交互式 TUI) — Linux / Git Bash
#
# 用法:
#   ./setup.sh                交互式菜单
#   ./setup.sh --sync         非交互全量同步(自动化/CI)
#   ./setup.sh --machine=win-personal   指定机器覆盖层
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
CORE_FILES=(AGENTS.md models.json keybindings.json)
CORE_DIRS=(extensions skills prompts)
EXT_PKGS=(pi-subagents pi-mcp-adapter pi-web-access pi-blackhole pi-background-tasks)

# --- 颜色(非 tty 自动禁用) ------------------------------------------------
if [ -t 1 ]; then
  C_RESET='\e[0m'; C_BOLD='\e[1m'; C_GREEN='\e[32m'; C_YELLOW='\e[33m'; C_CYAN='\e[36m'; C_DIM='\e[2m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''; C_DIM=''
fi
say()  { printf "${C_GREEN}==>${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}!!${C_RESET} %s\n" "$*"; }
hr()   { printf "${C_DIM}%s${C_RESET}\n" '------------------------------------'; }

# --- 机器检测 ---------------------------------------------------------------
detect_machine() {
  [ -n "${PI_MACHINE:-}" ] && { echo "$PI_MACHINE"; return; }
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "win-personal"; return ;;
  esac
  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && \
     { [ -n "${SSH_TTY:-}" ] || [ -n "${SSH_CONNECTION:-}" ] || [ ! -t 0 ]; }; then
    echo "linux-headless"
  else
    echo "linux-personal"
  fi
}
MACHINE="$(detect_machine)"

# --- 核心同步 ---------------------------------------------------------------
sync_core() {
  mkdir -p "$PI_DIR"
  for f in "${CORE_FILES[@]}"; do cp -f "$REPO/$f" "$PI_DIR/$f"; echo "  + $f"; done
  for d in "${CORE_DIRS[@]}"; do
    mkdir -p "$PI_DIR/$d"
    cp -rf "$REPO/$d/." "$PI_DIR/$d/"
    echo "  + $d/"
  done
}

apply_overlay() {
  local m="$1" M_DIR="$REPO/machines/$1"
  echo "  覆盖层: $m"
  # settings.json: 保留已存在配置(含 pi 管理的 packages 等键),合并 core + 机器覆盖
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs=require("fs");
      const [existing, core, overlay, out] = process.argv.slice(1);
      const base = fs.existsSync(existing) ? JSON.parse(fs.readFileSync(existing,"utf8")) : {};
      for (const p of [core, overlay]) {
        if (fs.existsSync(p)) Object.assign(base, JSON.parse(fs.readFileSync(p,"utf8")));
      }
      fs.writeFileSync(out, JSON.stringify(base, null, 2));
    ' "$PI_DIR/settings.json" "$REPO/settings.json" "$M_DIR/settings.json" "$PI_DIR/settings.json"
    echo "  + settings.json (merge core+overlay)"
  else
    cp -f "$REPO/settings.json" "$PI_DIR/settings.json"
    [ -f "$M_DIR/settings.json" ] && cp -f "$M_DIR/settings.json" "$PI_DIR/settings.json"
    echo "  + settings.json (replace fallback)"
  fi
  if [ -f "$M_DIR/mcp.json" ]; then
    cp -f "$M_DIR/mcp.json" "$PI_DIR/mcp.json"
    echo "  + machines/$m/mcp.json"
  fi
  if [ -d "$M_DIR/extensions" ]; then
    mkdir -p "$PI_DIR/extensions"
    cp -rf "$M_DIR/extensions/." "$PI_DIR/extensions/"
    echo "  + machines/$m/extensions/"
  fi
}

# --- auth.json ---------------------------------------------------------------
has_keys() { [ -s "$PI_DIR/auth.json" ] && ! grep -q '""' "$PI_DIR/auth.json"; }

auth_status() {
  if ! [ -s "$PI_DIR/auth.json" ]; then echo "  (无 auth.json)"; return; fi
  if command -v node >/dev/null 2>&1; then
    PI_DIR="$PI_DIR" node -e '
      const fs=require("fs"), path=require("path");
      try {
        const a=JSON.parse(fs.readFileSync(path.join(process.env.PI_DIR,"auth.json"),"utf8"));
        for (const [p,v] of Object.entries(a)) {
          console.log("  " + p + ": " + (v && v.key ? "有 key" : "空"));
        }
      } catch(e){ console.log("  (无法解析 auth.json)"); }
    '
  else
    echo "  (auth.json 存在,node 不可用无法预览)"
  fi
}

ensure_auth() {
  if has_keys; then say "auth.json 已有 key,保留"; return; fi
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
    say "auth.json 已从 ~/.claude + ~/.codex 提取"
  else
    cp -f "$REPO/auth.example.json" "$PI_DIR/auth.json"
    warn "auth.json 为空模板 — 填 key 或运行 pi 后 /login"
  fi
}

# --- 扩展 ---------------------------------------------------------------
ensure_extensions() {
  if ! command -v pi >/dev/null 2>&1; then warn "pi 未安装 — 先装 pi 再重跑 setup"; return; fi
  say "确保核心扩展"
  for p in "${EXT_PKGS[@]}"; do
    pi install "npm:$p" >/dev/null 2>&1 && echo "  + npm:$p" || warn "npm:$p 安装失败"
  done
  # Windows 专属:PowerShell 适配器(替换 bash 工具为 pwsh)
  if [ "$MACHINE" = "win-personal" ]; then
    pi install "npm:@4fu/pi-pwsh" >/dev/null 2>&1 && echo "  + npm:@4fu/pi-pwsh (win)" || warn "npm:@4fu/pi-pwsh 安装失败"
  fi
}

# --- vendored 扩展(源码入库,构建产物不入库) ---------------------------
ensure_vendor() {
  if ! command -v pi >/dev/null 2>&1; then return; fi
  if [ -d "$REPO/vendor" ] && compgen -G "$REPO/vendor/*/" >/dev/null 2>&1; then
    say "构建并安装 vendored 扩展"
    for v in "$REPO"/vendor/*/; do
      local name
      name="$(basename "$v")"
      # 大体积 UI 资产不入库,按 download-assets.txt 从上游拉取
      if [ -f "$v/download-assets.txt" ]; then
        while IFS='|' read -r url dest; do
          [ -n "$url" ] || continue
          if [ ! -f "$v/$dest" ]; then
            curl -fsSL "$url" -o "$v/$dest" && echo "  + 下载 $name/$dest" || warn "下载 $name/$dest 失败"
          fi
        done < "$v/download-assets.txt"
      fi
      if (cd "$v" && npm install >/dev/null 2>&1 && node build.mjs >/dev/null 2>&1); then
        echo "  + 构建 $name"
        pi install "$v" >/dev/null 2>&1 && echo "  + 安装 $name" || warn "$name 安装失败"
      else
        warn "$name 构建失败"
      fi
    done
  fi
}

full_sync() {
  hr
  say "全量同步 (机器: $MACHINE)"
  sync_core
  apply_overlay "$MACHINE"
  ensure_auth
  ensure_extensions
  ensure_vendor
  hr
}

# --- 交互菜单 ---------------------------------------------------------------
menu() {
  clear 2>/dev/null || true
  printf "${C_BOLD}pi-config setup${C_RESET}   机器: ${C_CYAN}%s${C_RESET}\n" "$MACHINE"
  hr
  echo "  ${C_BOLD}1${C_RESET}) 全量同步(自动检测机器)"
  echo "  ${C_BOLD}2${C_RESET}) 选择机器覆盖层"
  echo "  ${C_BOLD}3${C_RESET}) 管理扩展"
  echo "  ${C_BOLD}4${C_RESET}) 管理 API 密钥"
  echo "  ${C_BOLD}5${C_RESET}) 环境自检"
  echo "  ${C_BOLD}q${C_RESET}) 退出"
  hr
  read -rp "  选择 > " c && echo "$c"
}

choose_machine() {
  local dirs=()
  for d in "$REPO"/machines/*/; do dirs+=("$(basename "$d")"); done
  hr
  echo "  可用机器覆盖层:"
  for i in "${!dirs[@]}"; do echo "    [$i] ${dirs[$i]}"; done
  echo "    [q] 取消"
  read -rp "  选择 > " sel
  if [ "$sel" != q ] && [[ "$sel" =~ ^[0-9]+$ ]] && [ "$sel" -lt "${#dirs[@]}" ]; then
    MACHINE="${dirs[$sel]}"
    hr; say "切换机器: $MACHINE"; full_sync
  fi
}

manage_extensions() {
  local enabled=()
  for i in "${!EXT_PKGS[@]}"; do enabled[$i]=1; done
  while true; do
    hr
    echo "  核心扩展(输编号切换开关;按$(( ${#EXT_PKGS[@]} ))应用):"
    for i in "${!EXT_PKGS[@]}"; do
      printf "    [%s] %d) %s\n" "${enabled[$i]:-0}" "$i" "${EXT_PKGS[$i]}"
    done
    printf "    [ ] %d) 全部应用并返回\n" "${#EXT_PKGS[@]}"
    echo "    [q] 返回"
    read -rp "  编号 > " sel
    [ "$sel" = q ] && return
    if [[ "$sel" =~ ^[0-9]+$ ]] && [ "$sel" -lt "${#EXT_PKGS[@]}" ]; then
      enabled[$sel]=$(( 1 - ${enabled[$sel]:-0} ))
    elif [ "$sel" = "${#EXT_PKGS[@]}" ]; then
      for i in "${!EXT_PKGS[@]}"; do
        if [ "${enabled[$i]:-0}" = 1 ]; then
          pi install "npm:${EXT_PKGS[$i]}" >/dev/null 2>&1 && say "安装 ${EXT_PKGS[$i]}" || warn "安装失败 ${EXT_PKGS[$i]}"
        else
          pi remove "npm:${EXT_PKGS[$i]}" >/dev/null 2>&1 && say "移除 ${EXT_PKGS[$i]}" || warn "移除失败 ${EXT_PKGS[$i]}"
        fi
      done
      return
    fi
  done
}

manage_auth() {
  while true; do
    hr
    echo "  API 密钥状态 ($PI_DIR/auth.json):"
    auth_status
    echo
    echo "  [1] 保留现有"
    echo "  [2] 从 ~/.claude + ~/.codex 提取"
    echo "  [3] 用 auth.example.json 重置(空)"
    echo "  [4] 清空 auth.json"
    echo "  [q] 返回"
    read -rp "  选择 > " sel
    case "$sel" in
      1) say "保留"; return ;;
      2) rm -f "$PI_DIR/auth.json"; ensure_auth; return ;;
      3) cp -f "$REPO/auth.example.json" "$PI_DIR/auth.json"; warn "已重置为模板(空)"; return ;;
      4) rm -f "$PI_DIR/auth.json"; warn "auth.json 已删除"; return ;;
      q) return ;;
    esac
  done
}

env_check() {
  hr
  echo "  机器: $MACHINE"
  echo "  OS: $(uname -srm)"
  if command -v pi >/dev/null 2>&1; then echo "  pi: $(pi --version 2>/dev/null)"; else echo "  pi: 未安装"; fi
  if command -v node >/dev/null 2>&1; then echo "  node: $(node --version)"; else echo "  node: 未安装"; fi
  echo "  ~/.pi/agent: $PI_DIR"
  echo "  本地扩展 .ts: $(ls "$PI_DIR"/extensions/*.ts 2>/dev/null | wc -l | tr -d ' ') 个"
  echo "  已装 pi 包:"
  pi list 2>/dev/null | sed 's/^/    /' || echo "    (pi list 不可用)"
  hr
}

# --- 入口 ---------------------------------------------------------------
SYNC_MODE=0
for a in "$@"; do
  case "$a" in
    --sync|-s) SYNC_MODE=1 ;;
    --machine=*) MACHINE="${a#--machine=}" ;;
    -h|--help) echo "用法: ./setup.sh [--sync] [--machine=NAME]"; exit 0 ;;
  esac
done

if [ "$SYNC_MODE" = 1 ]; then full_sync; exit 0; fi

if [ ! -t 0 ] || [ ! -t 1 ]; then
  warn "非交互环境,执行全量同步(指定 --sync 可静默)"
  full_sync
  exit 0
fi

while true; do
  c="$(menu)"
  case "$c" in
    1) full_sync ;;
    2) choose_machine ;;
    3) manage_extensions ;;
    4) manage_auth ;;
    5) env_check ;;
    q|Q) echo "bye"; exit 0 ;;
    *) warn "无效选择" ;;
  esac
  printf "\n  按回车继续..."
  read -r _
done
