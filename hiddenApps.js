// SPDX-License-Identifier: GPL-3.0-or-later

// Shared by the shell side and prefs, so it must not import anything.

export const KEY = 'hidden-apps';

export function get(settings) {
    return new Set(settings.get_strv(KEY));
}

export function add(settings, appId) {
    const ids = settings.get_strv(KEY);
    if (ids.includes(appId))
        return;
    settings.set_strv(KEY, [...ids, appId]);
}

export function remove(settings, appId) {
    const ids = settings.get_strv(KEY);
    if (!ids.includes(appId))
        return;
    settings.set_strv(KEY, ids.filter(id => id !== appId));
}
