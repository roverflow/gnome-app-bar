// SPDX-License-Identifier: GPL-3.0-or-later

// Animation durations in milliseconds, taken from GNOME Shell so the bar
// moves like the rest of the shell. actor.ease() multiplies them by the
// slow-down factor, and skips them when Accessibility > Animations is off.

// Icons appearing, leaving or changing size. DASH_ANIMATION_TIME in dash.js.
export const ITEM_TIME = 200;

// Tooltips and previews opening, and closing. The dash label times in
// dash.js, and POPUP_ANIMATION_TIME in boxpointer.js.
export const POPUP_SHOW_TIME = 150;
export const POPUP_HIDE_TIME = 100;

// The bottom panel sliding in. The panel's own transition time.
export const PANEL_TIME = 250;

// An icon shrinking while pressed, and growing back.
export const PRESS_TIME = 100;
