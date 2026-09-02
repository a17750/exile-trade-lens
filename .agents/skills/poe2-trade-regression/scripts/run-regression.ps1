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
  Invoke-Check 'category collector syntax' 'node' @('--check', 'scripts/collect-category-corpus.mjs')
  Invoke-Check 'category audit syntax' 'node' @('--check', 'scripts/audit-category-corpus.mjs')
  Invoke-Check 'category alignment syntax' 'node' @('--check', 'scripts/align-category-corpus.mjs')
  Invoke-Check 'skill gem corpus audit syntax' 'node' @('--check', 'scripts/audit-skill-gem-corpus.mjs')

  if (-not $SkipBuild) {
    Invoke-Check 'dataset build' 'node' @('scripts/build-data.mjs')
  }

  Invoke-Check 'quality gate' 'node' @('scripts/check-quality.mjs')
  Invoke-Check 'data pipeline' 'node' @('scripts/pipeline-test.mjs')
  Invoke-Check 'item/filter/stat smoke tests' 'node' @('scripts/smoke-test.mjs')
  Invoke-Check 'item name domain test' 'node' @('scripts/item-name-domain-test.mjs')
  Invoke-Check 'granted skill domain test' 'node' @('scripts/granted-skill-domain-test.mjs')
  Invoke-Check 'skill gem domain test' 'node' @('scripts/skill-gem-domain-test.mjs')
  if (Test-Path 'data/corpus/category-pages.en.json') {
    Invoke-Check 'skill gem first-page corpus audit' 'node' @('scripts/audit-skill-gem-corpus.mjs')
  }
  Invoke-Check 'granted skill DOM test' 'node' @('scripts/granted-skill-dom-test.mjs')
  Invoke-Check 'stat rendering variants test' 'node' @('scripts/stat-rendering-test.mjs')
  Invoke-Check 'Chinese item search cold-start test' 'node' @('scripts/search-cold-start-test.mjs')
  Invoke-Check 'item panel label DOM test' 'node' @('scripts/item-label-dom-smoke-test.mjs')
  Invoke-Check 'item property and stable data-field test' 'node' @('scripts/item-field-rendering-test.mjs')
  Invoke-Check 'translated-mode English hover test' 'node' @('scripts/hover-original-smoke-test.mjs')
  Invoke-Check 'background message tests' 'node' @('scripts/background-smoke-test.mjs')
  Invoke-Check 'page/background bridge tests' 'node' @('scripts/bridge-context-smoke-test.mjs')
  if (Test-Path 'data/corpus/category-pages.en.json') {
    Invoke-Check 'category corpus coverage' 'node' @('scripts/audit-category-corpus.mjs', '--locale', 'en', '--strict')
  }
  if ((Test-Path 'data/corpus/category-pages.en.json') -and (Test-Path 'data/corpus/category-pages.zh-TW.json')) {
    Invoke-Check 'category corpus candidate alignment' 'node' @('scripts/align-category-corpus.mjs')
  }
  Invoke-Check 'patch whitespace' 'git' @('diff', '--check')

  Write-Host ''
  Write-Host '[regression] PASS'
  Write-Host '[regression] Review reports/coverage-report.json, reports/quality-report.json, reports/review-queue.json, reports/official-tw-source-report.json, and reports/ggpk-source-report.json.'
}
finally {
  Pop-Location
}
