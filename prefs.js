// SPDX-License-Identifier: GPL-3.0-or-later

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AppearancePage} from './preferences/appearancePage.js';
import {BehaviorPage} from './preferences/behaviorPage.js';

export default class AppBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(new AppearancePage(settings));
        window.add(new BehaviorPage(settings));
    }
}
