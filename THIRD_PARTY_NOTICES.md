# Third-Party Notices

This document records third-party software, fonts, icons, and static resources in the v1.1.0 release candidate. Minimalist Translation itself is licensed under the **Minimalist Translation Source Available Non-Commercial License 1.0**. Third-party components remain governed by their own licenses. The published v1.0.0 inventory remains available in the v1.0.0 tag and release assets.

Inventory date: 2026-10-01. This is a candidate inventory, not a publication claim or legal advice.

## Audit result

| Scope | Result | Evidence and condition |
|---|---|---|
| Main Electron npm graph | Candidate inventory | 393 resolved install entries in its current lockfile; no missing license expression. |
| Experimental Desktop npm graph | Candidate inventory | 285 resolved install entries in its current lockfile; no missing license expression. |
| Combined npm inventory | Candidate inventory | 377 unique `package@version` pairs. Dual-licensed packages use the permissive option identified below. |
| Google fonts and Material Symbols | Compatible with notice | Inter, Manrope, Dancing Script: OFL-1.1; Material Symbols: Apache-2.0. No font binary is committed. |
| Tailwind CSS | Compatible and locally reproducible | Tailwind CSS 3.4.17 plus fixed forms/container-query plugins are lockfile-pinned and compiled into `tailwind.css` before start/package. |
| Desktop Python backend | Conditionally compatible; excluded from v1.1.0 candidate binary | Six direct packages remain unpinned and `pynput` is LGPL-3.0. The module is retained as experimental source but is not packaged in this candidate. |
| Project inline icons | Compatible | Inline SVGs and generated `MT` tray SVG are project-authored. |
| OS font fallbacks | Not redistributed | Only font-family names are referenced; the repository contains no copies. |
| Generated/static evidence | Not distributed | Images under ignored `tmp`, `.tmp`, `build`, and `dist` paths are not product assets. |

## JavaScript dependency inventory

The exhaustive machine-readable inventories, including every resolved transitive dependency and install path, are:

- `lingoflow-client/electron-app/package-lock.json`
- `desktop-tools/desktop-float-ball/electron-app/package-lock.json`

The candidate inventory read every `node_modules/*` entry from both current lockfiles. Result: **377 unique package/version pairs, 0 missing license expressions**. The final released source commit and binary must be checked again.

### License-family summary covering all 377 resolved package/version pairs

| License expression | Unique package/version pairs | Compatibility determination |
|---|---:|---|
| MIT | 293 | Compatible; preserve copyright and license text. |
| ISC | 40 | Compatible; preserve copyright and license text. |
| Apache-2.0 | 9 | Compatible; preserve license, notices, and modification statements where applicable. |
| BSD-2-Clause | 6 | Compatible; preserve notice and disclaimer. |
| BSD-3-Clause | 11 | Compatible; preserve notice, disclaimer, and non-endorsement clause. |
| BlueOak-1.0.0 | 9 | Compatible; preserve license notice. |
| Python-2.0 | 1 | Compatible; preserve notice. |
| 0BSD | 2 | Compatible. |
| WTFPL | 1 | Compatible; preserve upstream notice. |
| WTFPL OR ISC | 1 | Compatible under ISC. |
| WTFPL OR MIT | 1 | Compatible under MIT. |
| MIT OR CC0-1.0 | 1 | Compatible under MIT. |
| MIT OR GPL-3.0-or-later | 1 | Compatible under MIT; GPL is not selected. |
| MIT AND Zlib | 1 | Compatible; both permissive notice obligations apply. |

The non-single-license entries are:

| Component | Version | License selection |
|---|---:|---|
| `jszip` | 3.10.1 | MIT selected from `MIT OR GPL-3.0-or-later`. |
| `pako` | 1.0.11 | MIT and Zlib both apply. |
| `type-fest` | 0.13.1 | MIT selected from `MIT OR CC0-1.0`. |
| `utf8-byte-length` | 1.0.5 | MIT selected from `WTFPL OR MIT`. |
| `sanitize-filename` | 1.6.4 | ISC selected from `WTFPL OR ISC`. |
| `truncate-utf8-bytes` | 1.0.2 | WTFPL. |
| `tslib` | 1.14.1 | 0BSD. |
| `argparse` | 2.0.1 | Python-2.0. |

Direct runtime/build dependencies and their resolved versions are:

| Application | Component | Resolved version | License |
|---|---|---:|---|
| Main | `@pdf-lib/fontkit` | 1.1.1 | MIT |
| Main | `ajv` | 8.20.0 | MIT |
| Main | `docx` | 9.7.1 | MIT |
| Main | `pdf-lib` | 1.17.1 | MIT |
| Main | `pdfjs-dist` | 4.10.38 | Apache-2.0 |
| Main build | `electron` | 44.0.0 | MIT |
| Main build | `electron-builder` | 26.15.3 | MIT |
| Main build | `tailwindcss` | 3.4.17 | MIT |
| Main build | `@tailwindcss/forms` | 0.5.10 | MIT |
| Main build | `@tailwindcss/container-queries` | 0.1.1 | MIT |
| Desktop | `ws` | 8.21.0 | MIT |
| Desktop build | `electron` | 44.0.0 | MIT |
| Desktop build | `electron-builder` | 26.15.3 | MIT |

All transitive component names and exact versions remain enumerated in the two committed lockfiles rather than being duplicated as a second mutable dependency database here. Final binary packaging must preserve each installed package's included copyright/license files or generate an equivalent bundled license artifact; this Markdown inventory alone does not replace those texts.

Reference license texts: [MIT](https://spdx.org/licenses/MIT.html), [ISC](https://spdx.org/licenses/ISC.html), [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html), [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html), [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), [BlueOak-1.0.0](https://spdx.org/licenses/BlueOak-1.0.0.html), [0BSD](https://spdx.org/licenses/0BSD.html), [Python-2.0](https://spdx.org/licenses/Python-2.0.html), and [Zlib](https://spdx.org/licenses/Zlib.html).

## Python dependencies: experimental Desktop module

`desktop-tools/desktop-float-ball/python-backend/requirements.txt` declares the following direct dependencies without versions:

| Requirement | Upstream license | Compatibility assessment |
|---|---|---|
| `pynput` | LGPL-3.0 | Conditionally compatible. A bundled executable must preserve LGPL notices, provide corresponding LGPL-covered source, and permit replacement/relinking as applicable. Exact version and platform dependencies are unresolved. |
| `keyboard` | MIT | Compatible; exact version unresolved. |
| `pyperclip` | BSD | Compatible; exact version unresolved. |
| `websockets` | BSD-3-Clause | Compatible; exact version unresolved. |
| `deep-translator` | MIT | Compatible; exact version and transitive dependencies unresolved. |
| `openai` | Apache-2.0 | Compatible; exact version and transitive dependencies unresolved. |

Because there is no Python lockfile, the repository does not contain a complete resolved Python bill of materials. The experimental Desktop module remains excluded from the v1.1.0 candidate binary, installer, and stable-support scope. A future binary that includes it must first lock versions, hashes, and transitive dependencies and satisfy LGPL-3.0 packaging obligations.

## Fonts, icons, and static resources

| Resource | Use | License | Result |
|---|---|---|---|
| Inter | Google Fonts stylesheet in main and Desktop UI | SIL Open Font License 1.1 | Compatible; no font file committed. |
| Manrope | Google Fonts stylesheet in main and Desktop UI | SIL Open Font License 1.1 | Compatible; no font file committed. |
| Dancing Script | Google Fonts stylesheet in main UI | SIL Open Font License 1.1 | Compatible; no font file committed. |
| Material Symbols Outlined | Google Fonts icon font | Apache-2.0 | Compatible with attribution/notice. |
| Tailwind CSS | Local generated stylesheet in main UI | MIT | Fixed npm versions and lockfile; `tailwind.css` is rebuilt before start/package. |
| Inline SVG launcher/bubble icons | Embedded in project HTML/JavaScript | Project-authored | Covered by the project license. |
| Generated `MT` tray SVG | Constructed in Desktop `main.js` | Project-authored | Covered by the project license. |
| Segoe UI, Microsoft YaHei, Arial, Consolas, PingFang SC, SimHei and other fallbacks | CSS system-font references | OS/vendor licenses | Not redistributed. |

No committed product `.ttf`, `.otf`, `.woff`, `.woff2`, `.eot`, `.ico`, `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` asset was found outside ignored/generated output directories. Generated PDF page images and user documents are not project assets and must not be included in source or release archives.

## Release obligations and open gates

1. Keep the experimental Desktop module out of the v1.1.0 installer and binary release assets. Python locking and LGPL packaging become mandatory only before a future release includes that module.
2. Preserve third-party copyright and license files in final binary packages and release archives.
3. Re-run this inventory after any lockfile, dependency, font, icon, static-resource, packaging, or release-scope change.

The v1.1.0 candidate ASAR currently contains 35 npm package identities; the dependency's standalone benchmark fixture is excluded from packaging. A candidate archive must include its actual component inventory, Electron/Chromium notices, per-component license evidence and file checksums, and be bound to the matching installer SHA-256. The license Release Gate remains open until that archive and installer are verified against a frozen source commit. The published v1.0.0 license archive and its hash remain unchanged in the v1.0.0 Release.
