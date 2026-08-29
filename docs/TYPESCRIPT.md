# TypeScript extension workflow

The browser extension source is now maintained in TypeScript. Runtime files loaded by Chrome remain JavaScript because Chrome does not execute `.ts` files directly.

## Source and build output

- Authoritative source: `extension/**/*.ts`
- Generated runtime files: matching `extension/**/*.js`
- Manifest and HTML files continue to reference `.js` files.

Do not edit generated JavaScript by hand. Change the `.ts` source, then run:

```bash
npm install
npm run build:extension
```

Load or refresh the unpacked extension from the repository's `extension` directory after compiling. The generated JavaScript is intentionally kept beside the source so the existing unpacked-extension workflow and smoke tests continue to work.

## Checks

`npm run check:extension` validates the TypeScript compilation graph without emitting files. The PoE2 regression skill runs `npm run build:extension` before syntax, data, and runtime smoke tests, so a large refactor cannot silently leave stale JavaScript loaded by Chrome.

The current migration keeps compiler strictness relaxed while the legacy browser integration is incrementally typed. `noCheck` is temporary compatibility scaffolding for third-party page-hook objects and legacy DOM code; new modules should add explicit types and remove this escape hatch gradually.
