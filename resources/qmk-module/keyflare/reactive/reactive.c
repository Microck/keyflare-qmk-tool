// Copyright 2026 Microck
// SPDX-License-Identifier: GPL-2.0-or-later

#include QMK_KEYBOARD_H

ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1, 1, 0);

#ifndef LED_PIN_ON_STATE
#    define LED_PIN_ON_STATE 1
#endif

#ifdef KEYFLARE_REACTIVE_RGB_MATRIX
#    ifndef KEYFLARE_REACTIVE_RGB_MODE
#        define KEYFLARE_REACTIVE_RGB_MODE RGB_MATRIX_TYPING_HEATMAP
#    endif
#endif

static uint16_t keyflare_held_key_count;

#ifdef KEYFLARE_REACTIVE_RGB_MATRIX
static bool keyflare_rgb_state_saved;
static bool keyflare_saved_rgb_enabled;
static uint8_t keyflare_saved_rgb_mode;
#endif
#if defined(KEYFLARE_REACTIVE_NUM_LOCK) || defined(KEYFLARE_REACTIVE_CAPS_LOCK) || defined(KEYFLARE_REACTIVE_SCROLL_LOCK) || defined(KEYFLARE_REACTIVE_COMPOSE) || defined(KEYFLARE_REACTIVE_KANA)
static void keyflare_write_indicator(pin_t pin, bool enabled) {
    gpio_write_pin(pin, enabled ? LED_PIN_ON_STATE : !LED_PIN_ON_STATE);
}
#endif

static void keyflare_apply_reactive_state(bool active) {
#ifdef KEYFLARE_REACTIVE_RGB_MATRIX
    // Drive RGB Matrix without EEPROM writes so the user's saved effect and
    // on/off state survive the temporary reactive window and power cycles.
    if (active) {
        keyflare_rgb_state_saved = true;
        keyflare_saved_rgb_enabled = rgb_matrix_is_enabled();
        keyflare_saved_rgb_mode = rgb_matrix_get_mode();
        rgb_matrix_enable_noeeprom();
        rgb_matrix_mode_noeeprom(KEYFLARE_REACTIVE_RGB_MODE);
    } else if (keyflare_rgb_state_saved) {
        // QMK ignores mode changes while RGB is disabled, so restore the
        // saved mode first and only then restore the saved on/off state.
        rgb_matrix_mode_noeeprom(keyflare_saved_rgb_mode);
        if (!keyflare_saved_rgb_enabled) {
            rgb_matrix_disable_noeeprom();
        }
        keyflare_rgb_state_saved = false;
    }
#endif

#ifdef KEYFLARE_REACTIVE_BACKLIGHT
    // Drive the hardware directly so a temporary reactive state never changes EEPROM.
    backlight_set(active ? BACKLIGHT_LEVELS : (is_backlight_enabled() ? get_backlight_level() : 0));
#endif

#if defined(KEYFLARE_REACTIVE_NUM_LOCK) || defined(KEYFLARE_REACTIVE_CAPS_LOCK) || defined(KEYFLARE_REACTIVE_SCROLL_LOCK) || defined(KEYFLARE_REACTIVE_COMPOSE) || defined(KEYFLARE_REACTIVE_KANA)
    const led_t host_state = host_keyboard_led_state();
#endif

#ifdef KEYFLARE_REACTIVE_NUM_LOCK
    keyflare_write_indicator(LED_NUM_LOCK_PIN, active || host_state.num_lock);
#endif
#ifdef KEYFLARE_REACTIVE_CAPS_LOCK
    keyflare_write_indicator(LED_CAPS_LOCK_PIN, active || host_state.caps_lock);
#endif
#ifdef KEYFLARE_REACTIVE_SCROLL_LOCK
    keyflare_write_indicator(LED_SCROLL_LOCK_PIN, active || host_state.scroll_lock);
#endif
#ifdef KEYFLARE_REACTIVE_COMPOSE
    keyflare_write_indicator(LED_COMPOSE_PIN, active || host_state.compose);
#endif
#ifdef KEYFLARE_REACTIVE_KANA
    keyflare_write_indicator(LED_KANA_PIN, active || host_state.kana);
#endif
}

bool process_record_reactive(uint16_t keycode, keyrecord_t *record) {
    if (!process_record_reactive_kb(keycode, record)) {
        return false;
    }

    // RGB control keys must act on the user's real lighting state, never on
    // the temporary override. If the override is live, end it first; the
    // next ordinary keypress re-arms it from the updated state.
    if (IS_RGB_MATRIX_KEYCODE(keycode) || IS_RGB_KEYCODE(keycode)) {
        keyflare_apply_reactive_state(false);
        return true;
    }

    if (record->event.pressed) {
        keyflare_held_key_count++;
        if (keyflare_held_key_count == 1) {
            keyflare_apply_reactive_state(true);
        }
    } else if (keyflare_held_key_count > 0) {
        keyflare_held_key_count--;
        if (keyflare_held_key_count == 0) {
            keyflare_apply_reactive_state(false);
        }
    }

    return true;
}

void suspend_power_down_reactive(void) {
    keyflare_held_key_count = 0;
    keyflare_apply_reactive_state(false);
    suspend_power_down_reactive_kb();
}

bool shutdown_reactive(bool jump_to_bootloader) {
    keyflare_held_key_count = 0;
    keyflare_apply_reactive_state(false);
    return shutdown_reactive_kb(jump_to_bootloader);
}

#if defined(KEYFLARE_REACTIVE_CAPS_LOCK_RGB) || defined(KEYFLARE_REACTIVE_SCROLL_LOCK_RGB)
// Runs after the effect render each frame, so the indicator survives the
// reactive overlay. Colors only show while RGB Matrix is enabled; the
// indicator never force-enables it.
bool rgb_matrix_indicators_reactive(void) {
    led_t const host_state = host_keyboard_led_state();
#    ifdef KEYFLARE_REACTIVE_CAPS_LOCK_RGB
    rgb_matrix_set_color(
        KEYFLARE_REACTIVE_CAPS_LOCK_RGB_LED,
        host_state.caps_lock ? 255 : 0,
        0,
        0
    );
#    endif
#    ifdef KEYFLARE_REACTIVE_SCROLL_LOCK_RGB
    rgb_matrix_set_color(
        KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_LED,
        0,
        host_state.scroll_lock ? 255 : 0,
        0
    );
#    endif
    return true;
}
#endif
