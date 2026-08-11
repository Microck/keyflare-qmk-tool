# Keyflare design

Keyflare should feel familiar to a VIA user. It uses VIA's compact desktop layout, keyboard-first workspace, flat control panes, dark grey surfaces, and warm accent color. It does not use VIA branding, artwork, or device protocol.

This is Keyflare's design contract. The official VIA repository does not contain a `DESIGN.md`, so this file records the rules derived from VIA's public interface and source.

## Product shape

Keyflare has one job: select a QMK keyboard, select declared reactive outputs, choose a keymap, and build firmware. Keep the whole flow in one window.

```text
+--------------------------------------------------------------------------+
| KEYFLARE                 [ Configure ]               QMK ...  _  []  X   |
+--------------------------------------------------------------------------+
| QMK target                                                               |
| Keyboard name                                      Layout [ selector ]    |
|                                                                          |
|                         Keyboard preview                                 |
|                                                                          |
+----+----------------------+------------------------+----------------------+
| KB | Keyboard             | Reactive outputs       | Keymap and build     |
| LED| target search        | supported toggles only | default / import     |
| CFG| load                 | hardware color note    | build firmware       |
+----+----------------------+------------------------+----------------------+
| Build status                         Reactive on key press, hardware color |
+--------------------------------------------------------------------------+
```

## Layout rules

- Use a 50 px top strip. Center the active product section, as VIA does.
- Give the keyboard most of the window. The preview is the main object, not a card inside a dashboard.
- Dock configuration controls to the bottom in flat panes with shared borders.
- Put section icons in a narrow left rail.
- Keep build state in a thin status strip.
- Do not add an introduction, hero text, numbered steps, floating cards, or metric pills.
- Keep the minimum window large enough for the keyboard and all three control panes.

## Visual rules

- Main background: `#1d1b1b` to `#222222`.
- Menu and pane background: `#222222`.
- Control background: `#414141`.
- Primary accent: `#e8c4b8`.
- Accent text: `#363434`.
- Muted labels: near `#929090`.
- Use thin shared borders. Avoid stacked rounded containers.
- Use small radii on controls. The selected top item and rail item may use VIA-like rounded shapes.
- Use a compact sans-serif face. Prefer the system stack so the desktop package needs no web font.
- Use icons for navigation and window controls. Pair icons with text when the action can be unclear.

## Behavior rules

- Show only outputs that QMK metadata declares. Do not infer unsupported hardware.
- Do not show color controls. The installed LED sets the color.
- Keep unavailable controls visible when their position teaches the flow, but disable them clearly.
- Keep keyboard target search bounded to 50 suggestions.
- Keep the native application menu hidden. The custom top strip owns drag and window controls.
- Use motion only for active progress indicators. Honor reduced-motion preferences.

## Branding and icons

- Do not show a Keyflare logo in the interface.
- Use the word `KEYFLARE` only as a window label.
- Do not use VIA's logo, Chippy artwork, or Electron's default icon.
- The packaged application icon is a neutral keyboard symbol. Treat it as a file-type identifier, not an in-product brand mark.

## Accessibility

- Every icon-only button needs an accessible name.
- Preserve visible keyboard focus.
- Use native form controls where practical.
- Do not encode selected, ready, or error state by color alone.
- Keep text readable at the 900 by 640 minimum window size.

## VIA reference and attribution

The interface direction comes from the GPL-3.0 licensed [the-via/app](https://github.com/the-via/app) project. The closest upstream design sources are:

- [Global colors and typography](https://github.com/the-via/app/blob/main/src/app.global.css)
- [Configure pane grid](https://github.com/the-via/app/blob/main/src/components/panes/grid.tsx)
- [VIA license](https://github.com/the-via/app/blob/main/LICENSE)

Keyflare's components and styles are independently written for its smaller compile-only workflow. Keep this attribution when future work copies or closely translates VIA design details.
