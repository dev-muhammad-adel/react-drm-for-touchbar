/* SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Original: 2022 Hendrik G. Seliger
 * Forked and enhanced: 2024 Muhammed Hussien
 *
 * Based on Window Calls by ickyicky, with D-Bus signal support based on an
 * example by dceee. Source:
 * https://github.com/dev-muhammad-adel/window-calls-extended
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DBUS_IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.WindowMonitorPro">
    <method name="List">
      <arg type="s" direction="out" name="win"/>
    </method>
    <method name="FocusTitle">
      <arg type="s" direction="out"/>
    </method>
    <method name="FocusPID">
      <arg type="s" direction="out"/>
    </method>
    <method name="FocusID">
      <arg type="s" direction="out"/>
    </method>
    <method name="FocusClass">
      <arg type="s" direction="out"/>
    </method>
    <signal name="WindowFocusChanged">
      <arg type="s" name="window_id"/>
      <arg type="s" name="window_title"/>
      <arg type="s" name="window_class"/>
      <arg type="s" name="window_pid"/>
    </signal>
  </interface>
</node>`;

function focusedWindow() {
  return global.display.get_focus_window();
}

export default class WindowMonitorPro {
  enable() {
    this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_IFACE, this);
    this._dbus.export(
      Gio.DBus.session,
      '/org/gnome/Shell/Extensions/WindowMonitorPro',
    );
    this._focusChangedId = global.display.connect(
      'notify::focus-window',
      () => this._emitFocusChanged(),
    );
  }

  disable() {
    if (this._focusChangedId) {
      global.display.disconnect(this._focusChangedId);
      this._focusChangedId = null;
    }
    this._dbus?.flush();
    this._dbus?.unexport();
    this._dbus = null;
  }

  _emitFocusChanged() {
    const win = focusedWindow();
    const values = win
      ? [
          win.get_id().toString(),
          win.get_title() || '',
          win.get_wm_class() || '',
          win.get_pid().toString(),
        ]
      : ['0', 'Desktop', 'Desktop', '0'];

    this._dbus.emit_signal(
      'WindowFocusChanged',
      new GLib.Variant('(ssss)', values),
    );
  }

  List() {
    const windows = global.get_window_actors().map(actor => {
      const win = actor.meta_window;
      return {
        class: win.get_wm_class(),
        pid: win.get_pid(),
        id: win.get_id(),
        maximized:
          (win.maximized_horizontally ? 1 : 0) |
          (win.maximized_vertically ? 2 : 0),
        focus: win.has_focus(),
        title: win.get_title(),
      };
    });
    return JSON.stringify(windows);
  }

  FocusTitle() {
    return focusedWindow()?.get_title() || '';
  }

  FocusPID() {
    return focusedWindow()?.get_pid().toString() || '';
  }

  FocusID() {
    return focusedWindow()?.get_id().toString() || '';
  }

  FocusClass() {
    return focusedWindow()?.get_wm_class() || '';
  }
}
