[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$toolRoot = $PSScriptRoot
$cacheRoot = Join-Path $toolRoot '.cache'
$runtimeRoot = Join-Path $cacheRoot 'runtime'
$lockPath = Join-Path $toolRoot 'dependencies.lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$libCommit = [string]$lock.libGGPK3.commit
$libSource = Join-Path $cacheRoot ("LibGGPK3-" + $libCommit.Substring(0, 12))
$patchPath = Join-Path $toolRoot 'patches\libggpk3-ooz-readonly.patch'
$oozPath = Join-Path $runtimeRoot 'AnimeStudio.Ooz.dll'

New-Item -ItemType Directory -Force -Path $cacheRoot, $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $libSource '.git'))) {
  & git clone --filter=blob:none --no-checkout $lock.libGGPK3.repository $libSource
  if ($LASTEXITCODE -ne 0) { throw 'Failed to clone LibGGPK3.' }
  & git -C $libSource checkout --detach $libCommit
  if ($LASTEXITCODE -ne 0) { throw 'Failed to checkout the locked LibGGPK3 commit.' }
}

$actualCommit = (& git -C $libSource rev-parse HEAD).Trim()
if ($actualCommit -ne $libCommit) {
  throw "LibGGPK3 commit mismatch: expected $libCommit, got $actualCommit"
}

$patchMarker = Join-Path $libSource '.exile-trade-lens-ooz-patch'
if (-not (Test-Path -LiteralPath $patchMarker)) {
  & git -C $libSource apply --check $patchPath
  if ($LASTEXITCODE -eq 0) {
    & git -C $libSource apply $patchPath
    if ($LASTEXITCODE -ne 0) { throw 'Failed to apply the Ooz patch.' }
  } else {
    & git -C $libSource apply --reverse --check $patchPath
    if ($LASTEXITCODE -ne 0) {
      throw 'The locked LibGGPK3 source no longer accepts the Ooz patch.'
    }
  }
  [IO.File]::WriteAllText($patchMarker, $libCommit, [Text.UTF8Encoding]::new($false))
}

$downloadOoz = $true
if (Test-Path -LiteralPath $oozPath) {
  $existingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $oozPath).Hash.ToLowerInvariant()
  $downloadOoz = $existingHash -ne ([string]$lock.animeStudioOoz.sha256).ToLowerInvariant()
}
if ($downloadOoz) {
  Invoke-WebRequest -Uri $lock.animeStudioOoz.url -OutFile $oozPath
}
$oozHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $oozPath).Hash.ToLowerInvariant()
if ($oozHash -ne ([string]$lock.animeStudioOoz.sha256).ToLowerInvariant()) {
  throw "AnimeStudio.Ooz SHA-256 mismatch: $oozHash"
}

& dotnet build (Join-Path $libSource 'LibBundledGGPK3\LibBundledGGPK3.csproj') `
  -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Failed to build the locked LibGGPK3 dependency.' }

$required = @('LibBundle3.dll', 'LibBundledGGPK3.dll', 'LibGGPK3.dll')
foreach ($name in $required) {
  $candidate = Get-ChildItem -LiteralPath $libSource -Recurse -File -Filter $name |
    Where-Object { $_.FullName -match '[\\/]Release[\\/]' } |
    Select-Object -First 1
  if (-not $candidate) { throw "Built dependency not found: $name" }
  Copy-Item -LiteralPath $candidate.FullName -Destination (Join-Path $runtimeRoot $name) -Force
}

$assetsPath = Join-Path $libSource 'LibBundle3\obj\project.assets.json'
$assets = Get-Content -LiteralPath $assetsPath -Raw | ConvertFrom-Json
$packageRoot = $assets.packageFolders.PSObject.Properties.Name | Select-Object -First 1
$systemExtensionsPath = Join-Path $packageRoot (
  'aianlinb.systemextensions\' + $lock.systemExtensions.version + '\lib\net8.0\SystemExtensions.dll')
if (-not (Test-Path -LiteralPath $systemExtensionsPath)) {
  throw "NuGet dependency not found: $systemExtensionsPath"
}
Copy-Item -LiteralPath $systemExtensionsPath `
  -Destination (Join-Path $runtimeRoot 'SystemExtensions.dll') -Force

$ready = [ordered]@{
  schemaVersion = 1
  libGGPK3Commit = $libCommit
  animeStudioOozSha256 = $oozHash
  preparedAt = [DateTime]::UtcNow.ToString('O')
}
$readyJson = $ready | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'ready.json'), $readyJson + "`n", [Text.UTF8Encoding]::new($false))

Write-Host "GGPK read-only dependencies ready: $runtimeRoot"
