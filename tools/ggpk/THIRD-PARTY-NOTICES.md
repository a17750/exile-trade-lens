# Third-party notices

The GGPK developer tool is separate from the browser extension runtime.

## LibGGPK3

- Project: https://github.com/aianlinb/LibGGPK3
- Locked version: `v2.7.5` / `50c2d279b3806366f79e831acc1c03bc35bb6442`
- License: GNU Affero General Public License v3.0 only
- Local change: the decompression binding is patched to use the open-source Ooz decoder and to disable native compression sizing calls. The tool never calls GGPK write APIs.

The complete corresponding LibGGPK3 source is fetched at the locked commit by `bootstrap.ps1`; the applied patch is committed under `patches/`.

LibGGPK3 uses `aianlinb.SystemExtensions` 1.8.0 (MIT), restored from NuGet during the locked dependency build.

## AnimeStudio.Ooz

- Project: https://github.com/EIHRTeam/AnimeStudio
- Locked commit: `1fbe5a570976d1f05db514993b4e1697e43cfa5d`
- Component: `AnimeStudio.Ooz.dll`
- License: MIT

The binary is downloaded only for the local developer tool and verified with the SHA-256 recorded in `dependencies.lock.json`.
