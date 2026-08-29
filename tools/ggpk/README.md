# Exile Trade Lens GGPK read-only extractor

This developer tool pairs selected English and Traditional Chinese tables from a locally licensed PoE2
`Content.ggpk`. It is not part of the browser extension runtime.

## Safety contract

- Opens `Content.ggpk` through a `FileStream` with `FileAccess.Read`.
- Uses `FileShare.Read`, preventing a writer from changing the file during extraction.
- Never calls GGPK/Index save, replace, compact, hash-renewal or repair APIs.
- Keeps extracted `.datc64` bytes in memory; raw tables are not written to disk.
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
sources/generated/ggpk/
  manifest.json
  base-items.zh-TW.json
  words.zh-TW.json
  affixes.zh-TW.json
  client-strings.zh-TW.json
```

The manifest contains source-table hashes, row geometry, coverage, and the read-only safety result. It does
not contain the local absolute game path.

## Current scope

- `BaseItemTypes`: stable-ID base-item translations.
- `Words`: same-version official fixed-name/name-component pairs.
- `Mods`: same-version English/Traditional-Chinese pairing by stable mod ID for `Domain=ITEM`
  prefix/suffix display names. Other mod domains and stat-description rendering are not mixed into this map.
- `ClientStrings`: same-version pairing by stable string ID. The runtime build currently selects only the
  reviewed `QualityItem` template (`Superior {0}` -> `精良的 {0}`), rather than exposing this broad table
  as a flat translation dictionary.

`Words` row numbers are safe for pairing the English and Traditional Chinese tables from the same GGPK.
They are not treated as permanent IDs across game patches.

The current PoE2 `Mods` schema is guarded by its observed 677-byte row size and the
`poe-tool-dev/dat-schema` field offsets. A schema change stops extraction and requires review instead of
silently producing shifted translations. Duplicate English affix names with different Traditional Chinese
translations are emitted as conflicts and excluded from the runtime maps.
