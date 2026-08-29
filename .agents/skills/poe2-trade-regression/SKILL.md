---
name: poe2-trade-regression
description: Run PoE2 trade translation regression checks after large changes or when item names, filters, stats/properties, translation data, or runtime hooks may be affected; produce a blocking report before delivery.
---

# PoE2 trade regression

Use this skill for an explicit regression request and after any change touching `extension/page/`, `extension/background/`, `extension/content/`, `extension/data/`, `scripts/`, `data/`, the manifest, or translation build workflow. A documentation-only change does not need the full suite.

## Procedure

1. Record the changed paths with `git diff --name-only` and classify the change as item, filter, stat/property, runtime bridge, or data pipeline.
2. Run the deterministic project runner from the repository root:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .agents/skills/poe2-trade-regression/scripts/run-regression.ps1
   ```

   The runner performs syntax checks, rebuilds the dataset, runs the quality gate, pipeline tests, item/filter/stat smoke tests, background and bridge tests, and `git diff --check`.
3. Treat any non-zero command or any blocking quality issue as a release blocker. Do not edit generated output merely to make a check pass.
4. Review the generated reports before delivery: `reports/coverage-report.json`, `reports/quality-report.json`, `reports/review-queue.json`, `reports/official-tw-source-report.json`, and `reports/ggpk-source-report.json`.
5. If runtime files changed, manually refresh the unpacked extension and reload a fresh trade page. Verify one item name, one filter group with options, and one stat/property. Record browser verification separately from deterministic local checks.

## Required invariants

- Item names: known `items`, `baseItems`, `fixedNames`, and exact entries remain populated; unknown names stay English rather than receiving a guessed or mixed translation; no rendered `(undefined)`.
- Filters: group labels and option labels resolve to a string; no undefined values or raw English fragments are introduced by a failed lookup.
- Stats/properties: translation is associated with the stable stat id; alternate renderings are accepted only for their declared id; placeholders and numeric values are preserved; unknown ids fall back to the original English text.
- Runtime isolation: one malformed `/fetch` item cannot cancel translation of the remaining items; a failed optional translation never replaces valid source data.
- Collection: missing-text reports exclude input values, autocomplete rows, already bilingual text, and transient render fragments.

The project workflow and the check matrix are documented in `docs/REGRESSION-CHECK.md`. Keep this skill focused on repeatable checks; put translation decisions and source policy in the project docs instead.
