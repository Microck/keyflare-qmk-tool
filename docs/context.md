# Keyflare

Keyflare helps a person produce QMK firmware that adds simple, fixed-color reactive lighting to a supported keyboard without inventing facts about its physical LED placement.

## Language

**Keyboard target**:
An exact keyboard and revision identified by QMK.
_Avoid_: Device, keyboard model

**Keyboard source**:
A local QMK folder containing `keyboard.json` and the source files needed by one keyboard family. Keyflare imports this folder into its managed QMK build tree without exposing its filesystem path to the renderer.
_Avoid_: Firmware binary, keyboard catalog

**Keymap source**:
An editable QMK keymap used as the basis for a firmware project. A compiled firmware artifact is not keymap source.
_Avoid_: Firmware file, binary

**Declared channel**:
An electrical backlight or indicator channel explicitly described by QMK metadata. It says what firmware can control, not where an LED is physically installed.
_Avoid_: Configurable key, detected LED

**Supported target**:
A keyboard target whose reactive lighting can use at least one standard declared channel without guessing or keyboard-specific behavior.
_Avoid_: Compatible keyboard

**Reactive lighting**:
Fixed-color lighting that remains active while at least one physical key is held and returns to its prior state after the last key is released.
_Avoid_: Effect, animation, RGB lighting

**Firmware project**:
The selected keyboard target, keymap source, declared channels, and resulting firmware artifact considered as one current configuration.
_Avoid_: Profile, workspace

**Firmware artifact**:
A compiled QMK file, such as a `.hex`, `.bin`, or `.uf2`, ready for an external flashing tool.
_Avoid_: Source firmware, editable firmware

**Physical LED placement**:
The relationship between a declared channel and the LEDs actually installed on a specific keyboard build. Keyflare treats this as unknown unless explicit source data states it.
_Avoid_: Detected key lighting, inferred placement

**Logical key association**:
The key in the active keymap that sends Num Lock, Caps Lock, or Scroll Lock. Keyflare can highlight this key to explain an indicator selection, but the highlight does not locate the physical LED.
_Avoid_: Indicator LED location
