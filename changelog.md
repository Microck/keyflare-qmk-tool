# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Microck/keyflare-qmk-tool/compare/v0.1.3...v0.1.4
