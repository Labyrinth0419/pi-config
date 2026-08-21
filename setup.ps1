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
$piDir = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME '.pi\agent' }
$webConfigDir = if ($env:PI_CODING_AGENT_DIR) {
  $piDir
} elseif ($env:XDG_CONFIG_HOME) {
  Join-Path $env:XDG_CONFIG_HOME 'pi'
} else {
  Join-Path $HOME '.pi'
}
$coreFiles = @('AGENTS.md', 'models.json', 'keybindings.json')
$coreDirs = @('extensions', 'skills', 'prompts')
$extPkgs = @('pi-subagents', 'pi-mcp-adapter', 'pi-web-access', 'pi-blackhole', 'pi-background-tasks', 'pi-hashline-edit')
$managedExtSpecs = @('npm:pi-subagents', 'npm:pi-mcp-adapter', 'npm:pi-web-access@0.23.0', 'npm:pi-blackhole', 'npm:pi-background-tasks', 'npm:pi-hashline-edit', 'git:github.com/T50-Systems/pi-thread-goal', 'npm:pi-btw', 'npm:@eko24ive/pi-ask@1.2.0')

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "!! $m" -ForegroundColor Yellow }
function Hr { Write-Host ('-' * 36) -ForegroundColor DarkGray }

function Resolve-Machine {
  if ($Machine) { return $Machine }
  if ($env:PI_MACHINE) { return $env:PI_MACHINE }
  if ($env:OS -eq 'Windows_NT' -or [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) { return 'win-personal' }
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
  New-Item -ItemType Directory -Force $webConfigDir | Out-Null
  Copy-Item -Force (Join-Path $repo 'web-search.json') (Join-Path $webConfigDir 'web-search.json')
  Write-Host "  + web-search.json"
  foreach ($d in $coreDirs) {
    New-Item -ItemType Directory -Force (Join-Path $piDir $d) | Out-Null
    Get-ChildItem (Join-Path $repo $d) -Force | Copy-Item -Destination (Join-Path $piDir $d) -Recurse -Force
    Write-Host "  + $d/"
  }
  $blackholeDir = Join-Path $piDir 'pi-blackhole'
  New-Item -ItemType Directory -Force $blackholeDir | Out-Null
  Copy-Item -Force (Join-Path $repo 'pi-blackhole\pi-blackhole-config.json') (Join-Path $blackholeDir 'pi-blackhole-config.json')
  Write-Host "  + pi-blackhole/pi-blackhole-config.json"
}

function Apply-Overlay([string]$m) {
  $mDir = Join-Path $repo "machines\$m"
  Write-Host "  覆盖层: $m"
  # settings.json: 保留已存在配置(含 pi 管理的 packages 等键),合并 core + 机器覆盖
  $settings = [ordered]@{}
  if (Test-Path (Join-Path $piDir 'settings.json')) {
    $existing = Get-Content (Join-Path $piDir 'settings.json') -Raw | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) { $settings[$p.Name] = $p.Value }
  }
  foreach ($src in @((Join-Path $repo 'settings.json'), (Join-Path $mDir 'settings.json'))) {
    if (Test-Path $src) {
      $srcObj = Get-Content $src -Raw | ConvertFrom-Json
      foreach ($p in $srcObj.PSObject.Properties) { $settings[$p.Name] = $p.Value }
    }
  }
  $settings | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $piDir 'settings.json') -Encoding UTF8
  Write-Host "  + settings.json (merge core+overlay)"
  if (Test-Path (Join-Path $mDir 'mcp.json')) {
    Copy-Item -Force (Join-Path $mDir 'mcp.json') (Join-Path $piDir 'mcp.json')
    Write-Host "  + machines/$m/mcp.json"
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
  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { throw "pi 未安装 — 先装 pi 再重跑 setup" }
  Say "确保核心扩展"
  foreach ($p in $extPkgs) {
    $spec = if ($p -eq 'pi-web-access') { 'npm:pi-web-access@0.23.0' } else { "npm:$p" }
    & pi install $spec | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$spec 安装失败 (exit code $LASTEXITCODE)" }
    Write-Host "  + $spec"
  }
  $webAccessDir = Join-Path $piDir 'npm\node_modules\pi-web-access'
  $patchScript = Join-Path $repo 'vendor\pi-web-access-patch.mjs'
  if (-not (Test-Path $webAccessDir) -or -not (Test-Path $patchScript) -or -not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "pi-web-access 补丁前置条件缺失"
  }
  & node $patchScript $webAccessDir
  if ($LASTEXITCODE -ne 0) { throw "pi-web-access 补丁未应用 (exit code $LASTEXITCODE)" }
  Write-Host "  + pi-web-access summary thinking patch"
  & pi install 'git:github.com/T50-Systems/pi-thread-goal' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pi-thread-goal 安装失败 (exit code $LASTEXITCODE)" }
  Write-Host "  + git:github.com/T50-Systems/pi-thread-goal"
  & pi install 'npm:pi-btw' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm:pi-btw 安装失败 (exit code $LASTEXITCODE)" }
  Write-Host "  + npm:pi-btw"
  & pi install 'npm:@eko24ive/pi-ask@1.2.0' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm:@eko24ive/pi-ask@1.2.0 安装失败 (exit code $LASTEXITCODE)" }
  Write-Host "  + npm:@eko24ive/pi-ask@1.2.0"
  # Windows 专属:PowerShell 适配器(替换 bash 工具为 pwsh)
  if ($script:M -eq 'win-personal') {
    & pi install 'npm:@4fu/pi-pwsh@0.8.10' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm:@4fu/pi-pwsh@0.8.10 安装失败 (exit code $LASTEXITCODE)" }
    Write-Host "  + npm:@4fu/pi-pwsh@0.8.10 (win)"
  }
  $taskRoutingPatch = Join-Path $repo 'vendor\pi-task-routing-patch.mjs'
  & node $taskRoutingPatch $piDir
  if ($LASTEXITCODE -ne 0) { throw "后台任务 ID 路由补丁未应用 (exit code $LASTEXITCODE)" }
  Write-Host "  + task ID routing patch"
}

# --- vendored 扩展(源码入库,构建产物不入库) ---
function Ensure-Vendor {
  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { return }
  $vdir = Join-Path $repo 'vendor'
  if (Test-Path $vdir) {
    $dirs = @(Get-ChildItem $vdir -Directory)
    if ($dirs.Count -gt 0) {
      Say "构建并安装 vendored 扩展"
      foreach ($d in $dirs) {
        try {
          # 大体积 UI 资产不入库,按 download-assets.txt 从上游拉取
          $dlFile = Join-Path $d.FullName 'download-assets.txt'
          if (Test-Path $dlFile) {
            foreach ($line in Get-Content $dlFile) {
              if ([string]::IsNullOrWhiteSpace($line)) { continue }
              $parts = $line.Split('|')
              $url = $parts[0].Trim(); $dest = $parts[1].Trim()
              if (-not (Test-Path (Join-Path $d.FullName $dest))) {
                try { Invoke-WebRequest -Uri $url -OutFile (Join-Path $d.FullName $dest); Write-Host "  + 下载 $($d.Name)/$dest" }
                catch { Warn "下载 $($d.Name)/$dest 失败: $($_.Exception.Message)" }
              }
            }
          }
          Push-Location $d.FullName
          & npm ci | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "$($d.Name) npm ci 失败 (exit code $LASTEXITCODE)" }
          & node build.mjs | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "$($d.Name) 构建失败 (exit code $LASTEXITCODE)" }
          Pop-Location
          & pi install $d.FullName | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "$($d.Name) 安装失败 (exit code $LASTEXITCODE)" }
          Write-Host "  + $($d.Name)"
        } catch {
          Pop-Location -ErrorAction SilentlyContinue
          Warn "$($d.Name) 构建/安装失败: $($_.Exception.Message)"
        }
      }
    }
  }
}

function Full-Sync {
  Hr
  Say "全量同步 (机器: $script:M)"
  Sync-Core
  Apply-Overlay $script:M
  Ensure-Auth
  Ensure-Extensions
  Ensure-Vendor
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
  $enabled = @{}; foreach ($e in $managedExtSpecs) { $enabled[$e] = $true }
  while ($true) {
    Hr
    Write-Host "  核心扩展(输编号切换开关;按$($managedExtSpecs.Count)应用):"
    for ($i = 0; $i -lt $managedExtSpecs.Count; $i++) {
      $mark = if ($enabled[$managedExtSpecs[$i]]) { 'x' } else { ' ' }
      Write-Host "    [$mark] $i) $($managedExtSpecs[$i])"
    }
    Write-Host "    [ ] $($managedExtSpecs.Count) 全部应用并返回"
    Write-Host "    [q] 返回"
    $sel = Read-Host "  编号"
    if ($sel -eq 'q') { return }
    if ($sel -match '^\d+$' -and [int]$sel -lt $managedExtSpecs.Count) {
      $enabled[$managedExtSpecs[[int]$sel]] = -not $enabled[$managedExtSpecs[[int]$sel]]
    } elseif ($sel -eq "$($managedExtSpecs.Count)") {
      foreach ($spec in $managedExtSpecs) {
        $removeSpec = if ($spec -like 'npm:*@*') { $spec.Substring(0, $spec.LastIndexOf('@')) } else { $spec }
        if ($enabled[$spec]) { try { pi install $spec | Out-Null; Say "安装 $spec" } catch { Warn "安装失败 $spec" } }
        else { try { pi remove $removeSpec | Out-Null; Say "移除 $spec" } catch { Warn "移除失败 $spec" } }
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
