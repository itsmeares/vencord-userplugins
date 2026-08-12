[CmdletBinding()]
param(
    [string]$VencordPath
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginsRoot = Join-Path $RepoRoot "plugins"

if (-not $VencordPath) {
    $VencordPath = Join-Path (Split-Path -Parent $RepoRoot) "Vencord"
}

$VencordPath = [System.IO.Path]::GetFullPath($VencordPath)
$UserPluginsRoot = Join-Path $VencordPath "src\userplugins"

if (-not (Test-Path (Join-Path $VencordPath "package.json"))) {
    throw "Vencord checkout not found at: $VencordPath"
}

if (-not (Test-Path $PluginsRoot)) {
    throw "Plugin source directory not found at: $PluginsRoot"
}

New-Item -ItemType Directory -Force -Path $UserPluginsRoot | Out-Null

$PluginDirs = Get-ChildItem -Path $PluginsRoot -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName "index.ts") -or Test-Path (Join-Path $_.FullName "index.tsx")
}

if (-not $PluginDirs) {
    Write-Host "No plugins found under $PluginsRoot"
    exit 0
}

foreach ($PluginDir in $PluginDirs) {
    $Destination = Join-Path $UserPluginsRoot $PluginDir.Name

    if (Test-Path $Destination) {
        $Existing = Get-Item -Force $Destination
        if ($Existing.LinkType -and $Existing.Target) {
            $Target = [System.IO.Path]::GetFullPath([string]$Existing.Target)
            if ($Target -eq $PluginDir.FullName) {
                Write-Host "OK      $($PluginDir.Name) already linked"
                continue
            }
        }

        throw "Refusing to overwrite existing userplugin path: $Destination"
    }

    if ($IsWindows) {
        New-Item -ItemType Junction -Path $Destination -Target $PluginDir.FullName | Out-Null
    } else {
        New-Item -ItemType SymbolicLink -Path $Destination -Target $PluginDir.FullName | Out-Null
    }

    Write-Host "LINKED  $($PluginDir.Name) -> $($PluginDir.FullName)"
}

Write-Host "`nOK - userplugins linked into $UserPluginsRoot"
