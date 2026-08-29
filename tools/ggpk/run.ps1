[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$GamePath,

  [string]$OutputPath = 'data'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
& (Join-Path $PSScriptRoot 'bootstrap.ps1')
if ($LASTEXITCODE -ne 0) { throw 'GGPK dependency bootstrap failed.' }

Push-Location $repositoryRoot
try {
  & dotnet run --project (Join-Path $PSScriptRoot 'ExileTradeLens.Ggpk.csproj') `
    -c Release -- `
    --ggpk $GamePath `
    --output $OutputPath `
    --repository-root $repositoryRoot
  if ($LASTEXITCODE -ne 0) { throw 'GGPK extraction failed.' }
} finally {
  Pop-Location
}
