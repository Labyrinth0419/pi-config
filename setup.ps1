# pi-config setup (交互式 TUI) — Windows 原生 PowerShell
#
# 用法:
#   .\setup.ps1              交互式菜单
#   .\setup.ps1 -Sync        非交互全量同步(自动化)
#   .\setup.ps1 -Machine win-personal   指定机器覆盖层
param(
  [string]$Machine = "",
  [switch]$Sync
)
$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$piDir = Join-Path $HOME '.pi\agent'
$coreFiles = @('AGENTS.md', 'settings.json', 'models.json', 'keybindings.json')
$coreDirs = @('extensions', 'skills', 'prompts')
$extPkgs = @('pi-subagents', 'pi-mcp-adapter', 'pi-web-access', 'pi-blackhole', 'pi-background-tasks')

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Hr { Write-Host ('-' * 36) -ForegroundColor DarkGray }

function Resolve-Machine {
  if ($Machine) { return $Machine }
  if ($env:PI_MACHINE) { return $env:PI_MACHINE }
  if ($IsWindows) { return 'win-personal' }
  if ($env:DISPLAY -or $env:WAYLAND_DISPLAY) { return 'linux-personal' }
  return 'linux-headless'
}
$script:M = Resolve-Machine

# --- 核心同步 ---
function Sync-Core {
  New-Item -ItemType Directory -Force $piDir | Out-Null
  foreach ($f in $coreFiles) {
    Copy-Item -Force (Join-Path $repo $f) (Join-Path $piDir $f)
    Write-Host "  + $f"
  }
  foreach ($d in $coreDirs) {
    New-Item -ItemType Directory -Force (Join-Path $piDir $d) | Out-Null
    Get-ChildItem (Join-Path $repo $d) -Force | Copy-Item -Destination (Join-Path $piDir $d) -Recurse -Force
    Write-Host "  + $d/"
  }
}

function Apply-Overlay([string]$m) {
  $mDir = Join-Path $repo "machines\$m"
  Write-Host "  覆盖层: $m"
  foreach ($f in @('settings.json', 'mcp.json')) {
    if (Test-Path (Join-Path $mDir $f)) {
      Copy-Item -Force (Join-Path $mDir $f) (Join-Path $piDir $f)
      Write-Host "  + machines/$m/$f"
    }
  }
  if (Test-Path (Join-Path $mDir 'extensions')) {
    New-Item -ItemType Directory -Force (Join-Path $piDir 'extensions') | Out-Null
    Get-ChildItem (Join-Path $mDir 'extensions') -Force | Copy-Item -Destination (Join-Path $piDir 'extensions') -Recurse -Force
    Write-Host "  + machines/$m/extensions/"
  }
}

# --- auth.json ---
function Has-Keys {
  if (-not (Test-Path $piDir\auth.json)) { return $false }
  try {
    $a = Get-Content "$piDir\auth.json" -Raw | ConvertFrom-Json
    return (($a.PSObject.Properties | Where-Object { $_.Value.key -and $_.Value.key -ne '' } | Measure-Object).Count -gt 0)
  } catch { return $false }
}

function Show-AuthStatus {
  if (-not (Test-Path "$piDir\auth.json")) { Write-Host "  (无 auth.json)"; return }
  try {
    $a = Get-Content "$piDir\auth.json" -Raw | ConvertFrom-Json
    foreach ($p in $a.PSObject.Properties) {
      $has = if ($p.Value.key -and $p.Value.key -ne '') { '有 key' } else { '空' }
      Write-Host "  $($p.Name): $has"
    }
  } catch { Write-Host "  (无法解析 auth.json)" }
}

function Ensure-Auth {
  if (Has-Keys) { Say "auth.json 已有 key,保留"; return }
  $creds = @{}
  if (Test-Path "$HOME\.claude\settings.json") {
    try {
      $claude = Get-Content "$HOME\.claude\settings.json" -Raw | ConvertFrom-Json
      if ($claude.env.ANTHROPIC_AUTH_TOKEN) { $creds['deepseek'] = @{ type = 'api_key'; key = $claude.env.ANTHROPIC_AUTH_TOKEN } }
    } catch {}
  }
  if (Test-Path "$HOME\.codex\auth.json") {
    try {
      $codex = Get-Content "$HOME\.codex\auth.json" -Raw | ConvertFrom-Json
      if ($codex.OPENAI_API_KEY) { $creds['lucen'] = @{ type = 'api_key'; key = $codex.OPENAI_API_KEY } }
    } catch {}
  }
  if ($creds.Count -gt 0) {
    $creds | ConvertTo-Json -Depth 4 | Set-Content "$piDir\auth.json" -Encoding UTF8
    Say "auth.json 已从 ~/.claude + ~/.codex 提取"
  } else {
    Copy-Item -Force (Join-Path $repo 'auth.example.json') "$piDir\auth.json"
    Warn "auth.json 为空模板 — 填 key 或运行 pi 后 /login"
  }
}

# --- 扩展 ---
function Ensure-Extensions {
  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { Warn "pi 未安装 — 先装 pi 再重跑 setup"; return }
  Say "确保核心扩展"
  foreach ($p in $extPkgs) {
    try { pi install "npm:$p" | Out-Null; Write-Host "  + npm:$p" } catch { Warn "npm:$p 安装失败" }
  }
}

function Full-Sync {
  Hr
  Say "全量同步 (机器: $script:M)"
  Sync-Core
  Apply-Overlay $script:M
  Ensure-Auth
  Ensure-Extensions
  Hr
}

# --- 交互菜单 ---
function Show-Menu {
  Clear-Host
  Write-Host "pi-config setup   机器: $($script:M)" -ForegroundColor Cyan
  Hr
  Write-Host "  [1] 全量同步(自动检测机器)"
  Write-Host "  [2] 选择机器覆盖层"
  Write-Host "  [3] 管理扩展"
  Write-Host "  [4] 管理 API 密钥"
  Write-Host "  [5] 环境自检"
  Write-Host "  [q] 退出"
  Hr
  $c = Read-Host "  选择"
  return $c
}

function Choose-Machine {
  $dirs = @(Get-ChildItem (Join-Path $repo 'machines') -Directory | Select-Object -ExpandProperty Name)
  Hr
  Write-Host "  可用机器覆盖层:"
  for ($i = 0; $i -lt $dirs.Count; $i++) { Write-Host "    [$i] $($dirs[$i])" }
  Write-Host "    [q] 取消"
  $sel = Read-Host "  选择"
  if ($sel -ne 'q' -and $sel -match '^\d+$' -and [int]$sel -lt $dirs.Count) {
    $script:M = $dirs[[int]$sel]
    Hr; Say "切换机器: $script:M"; Full-Sync
  }
}

function Manage-Extensions {
  $enabled = @{}; foreach ($e in $extPkgs) { $enabled[$e] = $true }
  while ($true) {
    Hr
    Write-Host "  核心扩展(输编号切换开关;按$($extPkgs.Count)应用):"
    for ($i = 0; $i -lt $extPkgs.Count; $i++) {
      $mark = if ($enabled[$extPkgs[$i]]) { 'x' } else { ' ' }
      Write-Host "    [$mark] $i) $($extPkgs[$i])"
    }
    Write-Host "    [ ] $($extPkgs.Count) 全部应用并返回"
    Write-Host "    [q] 返回"
    $sel = Read-Host "  编号"
    if ($sel -eq 'q') { return }
    if ($sel -match '^\d+$' -and [int]$sel -lt $extPkgs.Count) {
      $enabled[$extPkgs[[int]$sel]] = -not $enabled[$extPkgs[[int]$sel]]
    } elseif ($sel -eq "$($extPkgs.Count)") {
      foreach ($e in $extPkgs) {
        if ($enabled[$e]) { try { pi install "npm:$e" | Out-Null; Say "安装 $e" } catch { Warn "安装失败 $e" } }
        else { try { pi remove "npm:$e" | Out-Null; Say "移除 $e" } catch { Warn "移除失败 $e" } }
      }
      return
    }
  }
}

function Manage-Auth {
  while ($true) {
    Hr
    Write-Host "  API 密钥状态 ($piDir\auth.json):"
    Show-AuthStatus
    Write-Host ""
    Write-Host "  [1] 保留现有"
    Write-Host "  [2] 从 ~/.claude + ~/.codex 提取"
    Write-Host "  [3] 用 auth.example.json 重置(空)"
    Write-Host "  [4] 清空 auth.json"
    Write-Host "  [q] 返回"
    $sel = Read-Host "  选择"
    switch ($sel) {
      '1' { Say "保留"; return }
      '2' { Remove-Item "$piDir\auth.json" -Force -ErrorAction SilentlyContinue; Ensure-Auth; return }
      '3' { Copy-Item -Force (Join-Path $repo 'auth.example.json') "$piDir\auth.json"; Warn "已重置为模板(空)"; return }
      '4' { Remove-Item "$piDir\auth.json" -Force -ErrorAction SilentlyContinue; Warn "auth.json 已删除"; return }
      'q' { return }
    }
  }
}

function Show-Env {
  Hr
  Write-Host "  机器: $script:M"
  Write-Host "  OS: $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
  $piCmd = Get-Command pi -ErrorAction SilentlyContinue
  if ($piCmd) { Write-Host "  pi: $(pi --version)" } else { Write-Host "  pi: 未安装" }
  if (Get-Command node -ErrorAction SilentlyContinue) { Write-Host "  node: $(node --version)" } else { Write-Host "  node: 未安装" }
  Write-Host "  ~/.pi/agent: $piDir"
  $localExt = @(Get-ChildItem "$piDir\extensions\*.ts" -ErrorAction SilentlyContinue).Count
  Write-Host "  本地扩展 .ts: $localExt 个"
  Write-Host "  已装 pi 包:"
  try { pi list | ForEach-Object { Write-Host "    $_" } } catch { Write-Host "    (pi list 不可用)" }
  Hr
}

# --- 入口 ---
if ($Sync) { Full-Sync; exit 0 }

# 非交互(stdin 被重定向)时退回全量同步
if ([Console]::IsInputRedirected) {
  Warn "非交互环境,执行全量同步(指定 -Sync 可静默)"
  Full-Sync
  exit 0
}

while ($true) {
  $c = Show-Menu
  switch ($c) {
    '1' { Full-Sync }
    '2' { Choose-Machine }
    '3' { Manage-Extensions }
    '4' { Manage-Auth }
    '5' { Show-Env }
    'q' { Write-Host "bye"; exit 0 }
    default { Warn "无效选择" }
  }
  Read-Host "`n  按回车继续..."
}
