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
$MarkerName = ".vencord-userplugins-managed"

if (-not (Test-Path (Join-Path $VencordPath "package.json"))) {
    throw "Vencord checkout not found at: $VencordPath"
}

if (-not (Test-Path $PluginsRoot)) {
    throw "Plugin source directory not found at: $PluginsRoot"
}

New-Item -ItemType Directory -Force -Path $UserPluginsRoot | Out-Null

$PluginDirs = Get-ChildItem -Path $PluginsRoot -Directory | Where-Object {
    (Test-Path (Join-Path $_.FullName "index.ts")) -or
    (Test-Path (Join-Path $_.FullName "index.tsx"))
}

if (-not $PluginDirs) {
    Write-Host "No plugins found under $PluginsRoot"
    exit 0
}

foreach ($PluginDir in $PluginDirs) {
    $Destination = Join-Path $UserPluginsRoot $PluginDir.Name
    $Marker = Join-Path $Destination $MarkerName

    if (Test-Path $Destination) {
        $Existing = Get-Item -Force $Destination

        if ($Existing.LinkType -and $Existing.Target) {
            $Target = [System.IO.Path]::GetFullPath([string]$Existing.Target)
            if ($Target -ne $PluginDir.FullName) {
                throw "Refusing to replace unrelated link at: $Destination"
            }

            Remove-Item -LiteralPath $Destination -Force
        } elseif (Test-Path $Marker) {
            Remove-Item -LiteralPath $Destination -Recurse -Force
        } else {
            throw "Refusing to overwrite unmanaged userplugin path: $Destination"
        }
    }

    Copy-Item -LiteralPath $PluginDir.FullName -Destination $Destination -Recurse
    New-Item -ItemType File -Force -Path (Join-Path $Destination $MarkerName) | Out-Null

    Write-Host "SYNCED  $($PluginDir.Name) -> $Destination"
}

Write-Host "`nOK - userplugins synced into $UserPluginsRoot"
