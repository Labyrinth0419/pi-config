# pi-config setup — Windows 原生 PowerShell
# 用法:  .\setup.ps1            # 默认 win-personal
#        .\setup.ps1 -Machine win-personal
param(
  [string]$Machine = ""
)
$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$piDir = Join-Path $HOME '.pi\agent'

function Resolve-Machine {
  if ($Machine) { return $Machine }
  if ($env:PI_MACHINE) { return $env:PI_MACHINE }
  return 'win-personal'   # Windows 个人机
}
$m = Resolve-Machine
Write-Host "==> machine overlay: $m"

# --- 核心配置同步 ---
New-Item -ItemType Directory -Force $piDir | Out-Null
foreach ($f in @('AGENTS.md', 'settings.json', 'models.json', 'keybindings.json')) {
  Copy-Item -Force (Join-Path $repo $f) (Join-Path $piDir $f)
  Write-Host "  + $f"
}
foreach ($d in @('extensions', 'skills', 'prompts')) {
  New-Item -ItemType Directory -Force (Join-Path $piDir $d) | Out-Null
  Get-ChildItem (Join-Path $repo $d) -Force | Copy-Item -Destination (Join-Path $piDir $d) -Recurse -Force
  Write-Host "  + $d/"
}

# --- 机器覆盖层 ---
$mDir = Join-Path $repo "machines\$m"
foreach ($f in @('settings.json', 'mcp.json')) {
  if (Test-Path (Join-Path $mDir $f)) {
    Copy-Item -Force (Join-Path $mDir $f) (Join-Path $piDir $f)
    Write-Host "  + machines/$m/$f (overlay)"
  }
}
if (Test-Path (Join-Path $mDir 'extensions')) {
  New-Item -ItemType Directory -Force (Join-Path $piDir 'extensions') | Out-Null
  Get-ChildItem (Join-Path $mDir 'extensions') -Force | Copy-Item -Destination (Join-Path $piDir 'extensions') -Recurse -Force
  Write-Host "  + machines/$m/extensions/ (overlay)"
}

# --- auth.json ---
$auth = Join-Path $piDir 'auth.json'
$authObj = $null
if (Test-Path $auth) {
  try { $authObj = Get-Content $auth -Raw | ConvertFrom-Json } catch { $authObj = $null }
}
$hasKeys = $authObj -and (($authObj.PSObject.Properties | Where-Object { $_.Value.key -and $_.Value.key -ne '' } | Measure-Object).Count -gt 0)
if ($hasKeys) {
  Write-Host "==> auth.json exists with keys, keeping"
} else {
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
    $creds | ConvertTo-Json -Depth 4 | Set-Content $auth -Encoding UTF8
    Write-Host "==> auth.json written from ~/.claude + ~/.codex"
  } else {
    Copy-Item -Force (Join-Path $repo 'auth.example.json') $auth
    Write-Host "==> auth.json = example (empty) — fill keys or run: pi /login"
  }
}

# --- 核心扩展 ---
if (Get-Command pi -ErrorAction SilentlyContinue) {
  Write-Host "==> ensuring core extensions"
  foreach ($p in @('pi-subagents', 'pi-mcp-adapter', 'pi-web-access', 'pi-blackhole', 'pi-background-tasks')) {
    try { pi install "npm:$p" | Out-Null; Write-Host "  + npm:$p" } catch { Write-Host "  ! npm:$p failed" }
  }
} else {
  Write-Warning "!! pi not found on PATH — install pi first, then re-run setup"
}

Write-Host "==> done. verify with: pi --version && pi list"
