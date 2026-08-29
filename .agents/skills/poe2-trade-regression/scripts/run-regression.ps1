param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
Push-Location $repoRoot

function Invoke-Check([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Host "[regression] $Label"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Regression check failed: $Label (exit code $LASTEXITCODE)"
  }
}

try {
  Invoke-Check 'trade hook syntax' 'node' @('--check', 'extension/page/trade-hook.js')
  Invoke-Check 'service worker syntax' 'node' @('--check', 'extension/background/service-worker.js')

  if (-not $SkipBuild) {
    Invoke-Check 'dataset build' 'node' @('scripts/build-data.mjs')
  }

  Invoke-Check 'quality gate' 'node' @('scripts/check-quality.mjs')
  Invoke-Check 'data pipeline' 'node' @('scripts/pipeline-test.mjs')
  Invoke-Check 'item/filter/stat smoke tests' 'node' @('scripts/smoke-test.mjs')
  Invoke-Check 'Chinese item search cold-start test' 'node' @('scripts/search-cold-start-test.mjs')
  Invoke-Check 'Chinese dropdown search behavior test' 'node' @('scripts/dropdown-search-test.mjs')
  Invoke-Check 'item panel label DOM test' 'node' @('scripts/item-label-dom-smoke-test.mjs')
  Invoke-Check 'background message tests' 'node' @('scripts/background-smoke-test.mjs')
  Invoke-Check 'page/background bridge tests' 'node' @('scripts/bridge-context-smoke-test.mjs')
  Invoke-Check 'patch whitespace' 'git' @('diff', '--check')

  Write-Host ''
  Write-Host '[regression] PASS'
  Write-Host '[regression] Review reports/coverage-report.json, reports/quality-report.json, reports/review-queue.json, reports/official-tw-source-report.json, and reports/ggpk-source-report.json.'
}
finally {
  Pop-Location
}
