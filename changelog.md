# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.22] - 2026-08-27

### Fixed

- Make reactive RGB flash solid white while held and solid black idle so sparse matrix boards (e.g. SAM80-S) show visible feedback on every key

## [0.1.21] - 2026-08-27

### Fixed

- Switch reactive RGB Matrix from typing heatmap to solid reactive simple so first key press triggers immediately and flash is obvious (heatmap only recorded when mode already heatmap)

## [0.1.20] - 2026-08-27

### Fixed

- Enable RGB Matrix framebuffer effects for typing heatmap so reactive RGB Matrix actually compiles on targets without explicit framebuffer enable

## [0.1.19] - 2026-08-27

### Fixed

- Auto-heal missing ChibiOS submodule before RP2040 builds so startup_rp2040.mk error self-heals without requiring re-download

## [0.1.18] - 2026-08-27

### Fixed

- Update QMK submodules after checkout so RP2040 chibios-contrib is present (fixes startup_rp2040.mk missing error)

## [0.1.17] - 2026-08-27

### Fixed

- Center key labels with textAnchor middle/dominantBaseline central to prevent cutoff
- Size viewBox from primary keys only to avoid LAYOUT_all inflation causing horizontal misalignment
- Enlarge LED strip to 34px with background panel, correct x-mapping, 9px hit-targets so strip is visible/clickable
- Relax keyboard-stage sizing and workspace padding to prevent clipping
- Default rgb-indicator LEDs to 0 in reactive-module, firmware-build, and UI so build is not blocked without explicit selection

## [0.1.16] - 2026-08-26

### Fixed

- Require a complete QMK checkout before running its build commands so `qmk info` does not fall back to the stub CLI

## [0.1.15] - 2026-08-26

### Fixed

- Resolve imported keyboard path for `qmk info` when the source folder structure differs from the expected target

## [0.1.14] - 2026-08-26

### Fixed

- Let MSYS qmk use cwd after entering managed firmware so `qmk info` does not stay on the stub CLI

## [0.1.13] - 2026-08-26

### Fixed

- Pass a Windows-readable `QMK_HOME` into QMK MSYS and cd into the managed firmware tree so `qmk info` loads firmware commands

## [0.1.12] - 2026-08-26

### Fixed

- Keep `qmk doctor` on the user's QMK MSYS CLI so Windows setup does not fail with `invalid choice: 'doctor'`

## [0.1.11] - 2026-08-26

### Fixed

- Point QMK CLI at Keyflare's managed firmware checkout so imported keyboards resolve on Windows QMK MSYS

## [0.1.10] - 2026-08-26

### Changed

- Build against pinned [vial-qmk](https://github.com/vial-kb/vial-qmk) instead of upstream QMK, so firmware can be Vial-compatible

### Added

- Offer the board's Vial keymap when the imported source ships `keymaps/vial/vial.json`, compiling it natively instead of converting it to keymap.json
- Draw the declared RGB LED map as a clickable strip under the preview so indicator LEDs can be picked visually
- Let each RGB indicator channel use a chosen color instead of a hardcoded green or red

## [0.1.9] - 2026-08-26

### Changed

- Fail targets that declare RGB Matrix without a LED map at import time, explaining that `rgb_matrix.leds` is required, instead of failing compilation with an obscure error

### Added

- Offer Caps Lock and Scroll Lock indicator channels on RGB Matrix targets without dedicated indicator pins: the host lock state lights an LED chosen from the target's declared LED map

### Fixed

- Ghost stacked LAYOUT_all alternates in the layout preview so split-key options render as one readable keyboard
- Remove a stray file with an invalid Windows path from the repository

## [0.1.8] - 2026-08-25

### Added

- Offer a reactive RGB Matrix channel for targets that declare the feature with a driver or WS2812 pin, running the typing heatmap effect while keys are held and restoring the saved effect without EEPROM writes

## [0.1.7] - 2026-08-11

### Changed

- Use the supplied Keyflare logo for app windows, taskbars, the macOS dock, and installers
- Give the configuration panes the full width after removing the decorative navigation rail

### Removed

- Remove the unused SVG icon source

## [0.1.6] - 2026-08-11

### Changed

- Import a local QMK keyboard source folder instead of browsing the full upstream target catalog
- Keep QMK's compiler core in a sparse checkout without downloading its upstream keyboard catalog
- Highlight all keys for backlight and the matching logical lock key for indicator selections

### Fixed

- Keep imported target variant menus and reactive-output checkboxes aligned with their controls
- Set QMK MSYS's shell contract so Windows builds can run QMK's nested Git commands
- Compile backlight-only firmware without an unused indicator helper
- Preserve the current imported keyboard when a replacement source cannot be copied
- Retarget imported keymap files to the managed keyboard namespace before compiling
- Load keyboard layouts without a default keymap and recognize full QMK lock-key aliases

## [0.1.5] - 2026-08-11

### Fixed

- Run QMK from custom QMK MSYS installations even when Git for Windows is also installed

## [0.1.4] - 2026-08-11

### Changed

- Align the initial QMK setup screen with the VIA-inspired configuration workspace

### Fixed

- Run QMK and Git with the QMK MSYS tool paths for default and custom installations

[Unreleased]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.22...HEAD
[0.1.22]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.19...v0.1.20
[0.1.18]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.3...v0.1.4
