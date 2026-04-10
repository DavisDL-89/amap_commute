#Requires -Version 5.1
<#
.SYNOPSIS
  使用 GitHub CLI 为当前 manifest 版本创建 Release（需已 gh auth login）。
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Get-GhExe {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $p = Join-Path ${env:ProgramFiles} "GitHub CLI\gh.exe"
    if (Test-Path $p) { return $p }
    throw "未找到 gh。请安装: winget install GitHub.cli"
}

$gh = Get-GhExe
Write-Host "Using: $gh" -ForegroundColor DarkGray

& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "尚未登录 GitHub CLI，请在本机执行: gh auth login" -ForegroundColor Yellow
    exit 1
}

$manifestPath = Join-Path $Root "custom_components\amap_commute\manifest.json"
if (-not (Test-Path $manifestPath)) { throw "缺少 $manifestPath" }
$m = Get-Content $manifestPath -Raw | ConvertFrom-Json
$ver = $m.version
if (-not $ver) { throw "manifest.json 中无 version" }
$tag = "v$ver"

$notesFile = Join-Path $Root "docs\GITHUB_RELEASE_$tag.md"
$notesArg = @()
if (Test-Path $notesFile) {
    Write-Host "Release notes: $notesFile" -ForegroundColor Cyan
    $notesArg = @("--notes-file", $notesFile)
} else {
    Write-Host "未找到 $notesFile ，将使用 --generate-notes" -ForegroundColor Yellow
    $notesArg = @("--generate-notes")
}

# 若已存在同名 Release，则仅提示
$null = & $gh release view $tag 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Release $tag 已存在。若要改说明请执行:" -ForegroundColor Yellow
    if (Test-Path $notesFile) {
        Write-Host "  gh release edit $tag --notes-file `"$notesFile`"" -ForegroundColor Gray
    }
    exit 0
}

Write-Host "Creating release $tag ..." -ForegroundColor Green
& $gh release create $tag --title $tag @notesArg --latest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "完成。在浏览器打开仓库的 Releases 页面查看。" -ForegroundColor Green
