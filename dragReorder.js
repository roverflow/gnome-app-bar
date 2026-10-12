// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {AppButton} from './appButton.js';
import {ITEM_TIME} from './motion.js';

// Dragging an icon among the pinned apps reorders the favorites, and
// dropping a running app there pins it. A placeholder shows where the drop
// will land.
//
// `target` becomes the drop target, so drops in the gaps between icons
// count too. `box` holds the AppButtons. onBegin and onEnd bracket every
// drag.
export class DragReorder {
    constructor(target, box, {onBegin, onEnd}) {
        this._target = target;
        this._box = box;
        this._onBegin = onBegin;
        this._onEnd = onEnd;
        this._appFavorites = AppFavorites.getAppFavorites();

        this._monitor = null;
        this._source = null;
        this._sourceWidth = 0;
        this._placeholder = null;
        this._slot = -1;

        // Placeholders shrinking away after the slot moved on.
        this._oldPlaceholders = new Set();

        // DND looks up handleDragOver and acceptDrop on the delegate.
        target._delegate = this;
    }

    // Makes `button` draggable. The draggable goes away with the button.
    attach(button) {
        const draggable = DND.makeDraggable(button);
        draggable.connect('drag-begin', () => this._begin(button));
        draggable.connect('drag-end', () => this._end(button));
    }

    _begin(button) {
        this._onBegin();

        // The placeholder marks the slot instead. It grows in the same spot
        // as the button shrinks, so the icons around it stay put.
        this._source = button;
        this._sourceWidth = button.width;
        button.ease({
            scale_x: 0,
            scale_y: 0,
            opacity: 0,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => button.hide(),
        });

        this._monitor = {dragMotion: event => this._onDragMotion(event)};
        DND.addDragMonitor(this._monitor);
    }

    // The bar moves the button to where it was dropped before the next
    // frame, so it grows back in the slot the placeholder leaves.
    _end(button) {
        this._removeMonitor();
        this._clearPlaceholder();
        this._source = null;

        button.show();
        button.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._onEnd();
    }

    // handleDragOver is not called once the pointer leaves the target.
    _onDragMotion(dragEvent) {
        if (!this._target.contains(dragEvent.targetActor))
            this._clearPlaceholder();
        return DND.DragMotionResult.CONTINUE;
    }

    handleDragOver(source, _actor, x, _y, _time) {
        if (!this._isOwnButton(source))
            return DND.DragMotionResult.CONTINUE;

        const {slot, buttons} = this._slotForX(this._toStageX(x));
        const info = this._dropInfoForSlot(slot, buttons, source.app);
        if (!info) {
            this._clearPlaceholder();
            return DND.DragMotionResult.NO_DROP;
        }

        this._setPlaceholder(info.slot, buttons);
        return this._appFavorites.isFavorite(source.app.get_id())
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        // Use the slot the placeholder showed. Removing the placeholder
        // shifts later buttons, so a slot recomputed from x can be off by one.
        const shownSlot = this._placeholder ? this._slot : -1;
        this._clearPlaceholder();
        if (!this._isOwnButton(source))
            return false;

        const {slot: pointerSlot, buttons} = this._slotForX(this._toStageX(x));
        const slot = shownSlot >= 0 ? shownSlot : pointerSlot;
        const info = this._dropInfoForSlot(slot, buttons, source.app);
        if (!info)
            return false;

        const id = source.app.get_id();
        if (!this._appFavorites.isFavorite(id)) {
            this._appFavorites.addFavoriteAtPos(id, info.favoritesPos);
        } else if (this._appFavorites.getFavorites()[info.favoritesPos]
                       ?.get_id() !== id) {
            this._appFavorites.moveFavoriteToPos(id, info.favoritesPos);
        }
        return true;
    }

    // DND gives x relative to the target.
    _toStageX(x) {
        return this._target.get_transformed_position()[0] + x;
    }

    _isOwnButton(source) {
        return source instanceof AppButton && source.get_parent() === this._box;
    }

    // Slots count the buttons staying on the bar, not the dragged one.
    _slotForX(stageX) {
        const buttons = this._box.get_children().filter(child =>
            child instanceof AppButton && child !== this._source &&
            !child.leaving && child.visible);

        let slot = buttons.length;
        for (let i = 0; i < buttons.length; i++) {
            const [buttonX] = buttons[i].get_transformed_position();
            const [buttonWidth] = buttons[i].get_transformed_size();
            if (stageX < buttonX + buttonWidth / 2) {
                slot = i;
                break;
            }
        }
        return {slot, buttons};
    }

    // Returns null when the slot cannot take the drop.
    _dropInfoForSlot(slot, buttons, sourceApp) {
        const isFavorite = app => this._appFavorites.isFavorite(app.get_id());

        // Only the favorites order can be saved, so only that part of the
        // bar accepts drops.
        let favoritesEnd = 0;
        while (favoritesEnd < buttons.length &&
               isFavorite(buttons[favoritesEnd].app))
            favoritesEnd++;
        if (slot > favoritesEnd)
            return null;

        // In ungrouped mode, don't drop between two windows of another app.
        const before = buttons[slot - 1];
        const after = buttons[slot];
        if (before && after && before.app === after.app &&
            before.app !== sourceApp)
            return null;

        // Distinct favorites before the slot, not counting the dragged app.
        const seen = new Set();
        for (let i = 0; i < slot; i++) {
            const id = buttons[i].app.get_id();
            if (id !== sourceApp.get_id())
                seen.add(id);
        }
        return {slot, favoritesPos: seen.size};
    }

    // Moving to a new slot shrinks the old placeholder while a new one
    // grows, as the dash does.
    _setPlaceholder(slot, buttons) {
        if (this._placeholder && this._slot === slot)
            return;

        this._clearPlaceholder();

        this._placeholder = new St.Widget({
            style_class: 'appbar-drag-placeholder',
            y_expand: true,
            width: 0,
        });

        // The box also holds the dragged button and any leaving ones, so
        // place it next to a staying button.
        if (slot < buttons.length)
            this._box.insert_child_below(this._placeholder, buttons[slot]);
        else if (buttons.length > 0)
            this._box.insert_child_above(this._placeholder, buttons.at(-1));
        else
            this._box.add_child(this._placeholder);

        this._placeholder.ease({
            width: this._sourceWidth,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._slot = slot;
    }

    _clearPlaceholder() {
        if (!this._placeholder)
            return;

        const placeholder = this._placeholder;
        this._placeholder = null;
        this._slot = -1;

        this._oldPlaceholders.add(placeholder);
        placeholder.ease({
            width: 0,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._oldPlaceholders.delete(placeholder);
                placeholder.destroy();
            },
        });
    }

    _removeMonitor() {
        if (!this._monitor)
            return;

        DND.removeDragMonitor(this._monitor);
        this._monitor = null;
    }

    destroy() {
        this._removeMonitor();
        this._placeholder?.destroy();
        this._placeholder = null;
        this._oldPlaceholders.forEach(placeholder => placeholder.destroy());
        this._oldPlaceholders.clear();
        this._source = null;
        this._target._delegate = null;
        this._target = null;
        this._box = null;
    }
}
