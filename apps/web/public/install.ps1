# pella-metrics collector — installer (Windows PowerShell).
#
# Usage:
#   $env:PELLA_TOKEN = "pm_xxx"; irm https://pellametric.com/install.ps1 | iex
#
# Or with a token param (requires invoke-expression with &):
#   & ([scriptblock]::Create((irm https://pellametric.com/install.ps1))) -Token pm_xxx
#
# Installs pella.exe to $env:LOCALAPPDATA\Pella\pella.exe, writes the
# token to $env:USERPROFILE\.pella\config.env, and registers +
# starts the Scheduled Task at \Pella\Collector.

[CmdletBinding()]
param(
  [string]$Token = $env:PELLA_TOKEN,
  [string]$Url = $env:PELLA_URL,
  [string]$Version = '',
  [string]$Repo = 'pella-labs/pellametric',
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "pella-install: $msg" }
function Write-Err($msg)  { Write-Host "pella-install: $msg" -ForegroundColor Red }

if (-not $Token) {
  Write-Err '--Token is required (or set $env:PELLA_TOKEN).'
  Write-Err 'Get one at https://pellametric.com/setup/collector'
  exit 2
}

# Resolve release tag — follow the redirect from /releases/latest.
function Resolve-Tag {
  param([string]$Repo, [string]$Version)
  if ($Version) { return $Version }
  $resp = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -MaximumRedirection 0 -ErrorAction SilentlyContinue
  if (-not $resp -or -not $resp.Headers.Location) {
    # PowerShell 7+ auto-follows; grab the final url from the response URI instead.
    $resp = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -MaximumRedirection 5
    $tag = Split-Path -Leaf $resp.BaseResponse.RequestMessage.RequestUri.AbsoluteUri
  } else {
    $tag = Split-Path -Leaf $resp.Headers.Location
  }
  if (-not $tag -or $tag -eq 'latest' -or $tag -eq 'releases') {
    throw "could not resolve latest release tag for $Repo"
  }
  return $tag
}

$tag = Resolve-Tag -Repo $Repo -Version $Version
$asset = 'pella-windows-x64.exe'
Write-Step "installing $tag · target windows-x64"

$tmp = Join-Path $env:TEMP ("pella-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $base = "https://github.com/$Repo/releases/download/$tag"
  $assetPath = Join-Path $tmp $asset
  $sumsPath = Join-Path $tmp 'SHA256SUMS'

  Write-Step "downloading $asset..."
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $assetPath -UseBasicParsing
  Write-Step 'downloading SHA256SUMS...'
  Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing

  $expected = $null
  foreach ($line in Get-Content -Path $sumsPath) {
    $parts = ($line -split '\s+', 2)
    if ($parts.Length -lt 2) { continue }
    $name = $parts[1].TrimStart('*').Trim()
    if ($name -eq $asset) { $expected = $parts[0]; break }
  }
  if (-not $expected) { throw "$asset not listed in SHA256SUMS" }
  $actual = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) {
    throw "sha256 mismatch: got $actual, expected $expected"
  }
  Write-Step 'sha256 verified'

  $installDir = Join-Path $env:LOCALAPPDATA 'Pella'
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir 'pella.exe'

  # Replace a running binary cleanly — stop the service first if one
  # exists, then overwrite.
  if (Test-Path $dest) {
    & $dest stop 2>$null | Out-Null
  }
  Move-Item -Path $assetPath -Destination $dest -Force
  Write-Step "installed $dest"

  $loginArgs = @('login', '--token', $Token)
  if ($Url) { $loginArgs += @('--url', $Url) }
  if ($NoStart) { $loginArgs += '--no-start' }
  & $dest @loginArgs

  # Surface a PATH hint if pella isn't on the user PATH.
  $onPath = ($env:Path -split ';') | Where-Object { $_ -eq $installDir }
  if (-not $onPath) {
    Write-Step "note: $installDir is not on your PATH — add it, or invoke pella by full path."
  }
  Write-Step 'done.'
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
