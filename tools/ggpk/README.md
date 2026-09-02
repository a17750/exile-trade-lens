# Exile Trade Lens GGPK read-only extractor

This developer tool pairs selected English and Traditional Chinese tables from a locally licensed PoE2
`Content.ggpk`. It is not part of the browser extension runtime.

## Safety contract

- Opens `Content.ggpk` through a `FileStream` with `FileAccess.Read`.
- Uses `FileShare.Read`, preventing a writer from changing the file during extraction.
- Never calls GGPK/Index save, replace, compact, hash-renewal or repair APIs.
- Keeps extracted `.datc64`/`.csd` bytes in memory; raw tables are not written to disk.
- Writes normalized JSON only under the repository path selected with `--output`.
- Verifies game-file size and modified time before writing output.
- Does not attach to the game process, inject a DLL, read memory or access account credentials.

Close the game launcher/updater before running so it does not need write access while the read lock is held.

## Run

From the repository root:

```powershell
.\tools\ggpk\run.ps1 `
  -GamePath 'D:\games\Path of Exile 2\Content.ggpk'
```

The first run downloads locked source/binary dependencies into `tools/ggpk/.cache`, verifies them, applies
the committed decompression-only patch, and builds the local tool. Dependencies and licenses are recorded in
`dependencies.lock.json` and `THIRD-PARTY-NOTICES.md`.

Default normalized output:

```text
data/
  ggpk.json
```

`ggpk.json` keeps `manifest`, `baseItems`, `words`, `affixes`, `clientStrings`, and `skillGemTags` in separate top-level
sections. The embedded manifest contains source-table hashes, row geometry, coverage, and the read-only
safety result. It does not contain the local absolute game path.

## Current scope

- `BaseItemTypes`: stable-ID base-item translations.
- `Words`: same-version official fixed-name/name-component pairs.
- `Mods`: same-version English/Traditional-Chinese pairing by stable mod ID for `Domain=ITEM`
  prefix/suffix display names. Other mod domains and stat-description rendering are not mixed into this map.
- `PassiveSkills`: same-version pairing by row ID (`Id`) using the PoE2 schema's `Name` field. These complete
  node-name pairs feed `Allocates` translations; no component-level guesses are made.
- `GemTags`: same-version English/Traditional-Chinese pairing from
  `data/balance/gemtags.datc64` and its `traditional chinese` counterpart. The extractor reads the table key,
  parses the stable semantic ID embedded in `Name` (for example `AoESkill` in `[AoESkill|AoE]`), and emits
  `skillGemTags.bySemanticId`. This is the authoritative source for skill-gem tag rendering.
- `stat_descriptions.csd` and `passive_skill_stat_descriptions.csd`: UTF-16 English/Traditional-Chinese
  description blocks. Only unique pairs with equal normalized placeholder counts are retained as a conservative
  stat-description fallback; ambiguous blocks are reported as conflicts. Multi-variant description blocks are
  also retained as rendering families so plural, signed-value and conditional forms can stay attached to one
  Trade stat ID without inventing grammar.
- Semantic links inside those CSD blocks, such as `[Attack|攻擊]`, are paired by stable link ID and emitted as
  the isolated `linkedTerms` domain. They are not exposed as a global word-replacement dictionary.
- `ClientStrings`: same-version pairing by stable string ID. The runtime build currently selects only the
  reviewed `QualityItem` template (`Superior {0}` -> `精良的 {0}`), rather than exposing this broad table
  as a flat translation dictionary.

`Words` row numbers are safe for pairing the English and Traditional Chinese tables from the same GGPK.
They are not treated as permanent IDs across game patches.

The current PoE2 `Mods` schema is guarded by its observed 677-byte row size and the
`poe-tool-dev/dat-schema` field offsets. A schema change stops extraction and requires review instead of
silently producing shifted translations. Duplicate English affix names with different Traditional Chinese
translations are emitted as conflicts and excluded from the runtime maps.

## Updating after a game patch

Close the game and launcher updater, then run the command in **Run** against the installed `Content.ggpk`.
The same extraction pass always refreshes `GemTags`; it is not a separate manual step. Review the reported
`Skill-gem-tag usable coverage`, confirm `manifest.tables` contains both `gemtags.datc64` files, and then run
the project regression suite. A missing table, changed row geometry, mismatched semantic ID, or ambiguous
translation stops extraction/build instead of silently falling back to guessed text.
