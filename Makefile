UUID = gnome-app-bar@roverflow
EXTDIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
# `gnome-extensions pack` adds extension.js, prefs.js and metadata.json
# itself; everything else is listed here.
EXTRA = appBar.js appButton.js appMenu.js appearance.js dragReorder.js \
        hiddenApps.js hotkeys.js hoverPopups.js motion.js previews.js taskbarModel.js \
        layouts preferences stylesheet-dark.css stylesheet-light.css
SOURCES = extension.js prefs.js metadata.json schemas $(EXTRA)

.PHONY: install link uninstall enable disable pack logs test-shell

## Symlink the working tree; edits apply after the next shell restart.
link: schemas/gschemas.compiled
	mkdir -p $(dir $(EXTDIR))
	rm -rf $(EXTDIR)
	ln -sfn $(CURDIR) $(EXTDIR)
	@echo "linked $(EXTDIR) -> $(CURDIR)"

## Copy the files in.
install: schemas/gschemas.compiled
	mkdir -p $(EXTDIR)
	cp -r $(SOURCES) $(EXTDIR)/

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.appbar.gschema.xml
	glib-compile-schemas schemas/

.PHONY: prefs
prefs:
	gnome-extensions prefs $(UUID)

uninstall:
	rm -rf $(EXTDIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

## Build the zip for extensions.gnome.org.
pack: schemas/gschemas.compiled
	gnome-extensions pack --force \
	  $(foreach f,$(EXTRA),--extra-source=$(f)) \
	  --schema=schemas/org.gnome.shell.extensions.appbar.gschema.xml \
	  .

## Headless shell with only this extension, using separate settings.
test-shell:
	rm -rf /tmp/appbar-config && mkdir -p /tmp/appbar-config
	printf '%s\n' \
	  '#!/bin/bash' \
	  "gsettings set org.gnome.shell enabled-extensions \"['$(UUID)']\"" \
	  'gsettings set org.gnome.shell disable-user-extensions false' \
	  'exec gnome-shell --headless --virtual-monitor 1400x900 --wayland-display=appbar-test' \
	  > /tmp/appbar-run.sh
	chmod +x /tmp/appbar-run.sh
	XDG_CONFIG_HOME=/tmp/appbar-config APPBAR_DEBUG=1 G_MESSAGES_DEBUG=all \
	  dbus-run-session -- /tmp/appbar-run.sh 2>&1 | grep --line-buffered -iE 'appbar|JS ERROR'

logs:
	journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered "appbar\|extension"
