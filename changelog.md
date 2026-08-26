# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.16...HEAD
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
