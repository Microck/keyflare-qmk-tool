// Copyright 2026 Microck
// SPDX-License-Identifier: GPL-2.0-or-later

#include QMK_KEYBOARD_H

ASSERT_COMMUNITY_MODULES_MIN_API_VERSION(1, 0, 0);

#ifndef LED_PIN_ON_STATE
#    define LED_PIN_ON_STATE 1
#endif

static uint16_t keyflare_held_key_count;

#if defined(KEYFLARE_REACTIVE_NUM_LOCK) || defined(KEYFLARE_REACTIVE_CAPS_LOCK) || defined(KEYFLARE_REACTIVE_SCROLL_LOCK) || defined(KEYFLARE_REACTIVE_COMPOSE) || defined(KEYFLARE_REACTIVE_KANA)
static void keyflare_write_indicator(pin_t pin, bool enabled) {
    gpio_write_pin(pin, enabled ? LED_PIN_ON_STATE : !LED_PIN_ON_STATE);
}
#endif

static void keyflare_apply_reactive_state(bool active) {
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
