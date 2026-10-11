// SPDX-License-Identifier: GPL-3.0-or-later

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AppearancePage} from './preferences/appearancePage.js';
import {BehaviorPage} from './preferences/behaviorPage.js';

export default class AppBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const pages = [new AppearancePage(settings), new BehaviorPage(settings)];
        pages.forEach(page => window.add(page));

        // Settings handlers keep the pages alive; drop them with the window.
        window.connect('close-request', () => {
            pages.forEach(page => page.disconnectSettings());
            return false;
        });
    }
}
