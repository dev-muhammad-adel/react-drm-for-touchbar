#!/usr/bin/env python3
"""
config_gui.py — Python/PyGObject (GTK3 + gtk4-layer-shell-compatible
GtkLayerShell) desktop editor for the Touch Bar's config.ts.

Single-file app in the spirit of preview-app/gtk_layer_app.py:
  * Native Wayland layer surface — anchored bottom, full output width,
    keyboard on-demand (the same mechanism waybar uses).
  * Surgical config.ts patcher: only changed initializers, new properties,
    rebuilt DOCK.apps arrays and new react-icons imports ever rewrite bytes;
    comments, quote style and formatting of untouched code survive.
  * Custom Layer tab is a thin remote over the Touch Bar process's Unix
    socket bridge (drag a chip to the bottom edge → widget lands on the bar).

Run:  ./config_gui.py            (REACT_DRM_REPO_DIR overrides the repo path)
"""

import json
import os
import re
import socket
import subprocess
import sys
from collections import OrderedDict

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('GtkLayerShell', '0.1')
from gi.repository import Gdk, GLib, Gtk, GtkLayerShell  # noqa: E402

# ── Static tables ────────────────────────────────────────────────────────────

KEY = {
    'MUTE': 113, 'VOLUMEDOWN': 114, 'VOLUMEUP': 115, 'NEXTSONG': 163,
    'PLAYPAUSE': 164, 'PREVIOUSSONG': 165, 'LEFTMETA': 125, 'SEARCH': 217,
    'BRIGHTNESSDOWN': 224, 'BRIGHTNESSUP': 225, 'KBDILLUMDOWN': 229,
    'KBDILLUMUP': 230, 'LEFTCTRL': 29, 'LEFTALT': 56, 'LEFTSHIFT': 42,
    'TAB': 15, 'LEFT': 105, 'RIGHT': 106, 'UP': 103, 'DOWN': 108,
    'HOME': 102, 'ENTER': 28, 'ESC': 1, 'BACKSPACE': 14, 'PAGEUP': 104,
    'PAGEDOWN': 109, 'GRAVE': 41, 'F5': 63, 'F10': 68, 'F11': 87,
    'DELETE': 111, 'PRINT': 99, 'KEY_B': 48, 'KEY_COMMA': 51, 'KEY_F': 33,
    'KEY_H': 35, 'KEY_P': 25, 'KEY_R': 19, 'KEY_S': 31, 'KEY_T': 20,
    'KEY_W': 17, 'KEY_Z': 44,
}
CODE_TO_KEY_NAME = {c: n for n, c in KEY.items()}

SECTION_NAMES = [
    'DISPLAY', 'ESC_KEY', 'SLEEP', 'LAYER_TRANSITION', 'ACTIVE_WINDOW',
    'SCREENSHOT', 'DOLPHIN', 'KONSOLE', 'SYSTEMBAR', 'CAVA',
    'DEFAULT_BROWSER_KEYS', 'BROWSER_KEY_OVERRIDES',
    'DEFAULT_VSCODE_KEYS', 'VSCODE_KEY_OVERRIDES',
    'DOCK', 'FN_LAYER', 'FN_KEYS',
]

SECTION_LABELS = {
    'DISPLAY': 'Display', 'SLEEP': 'Sleep', 'DOCK': 'Dock',
    'DEFAULT_BROWSER_KEYS': 'Browser Keys',
    'BROWSER_KEY_OVERRIDES': 'Browser Overrides',
    'DEFAULT_VSCODE_KEYS': 'VS Code Keys',
    'VSCODE_KEY_OVERRIDES': 'VS Code Overrides',
    'ESC_KEY': 'Esc Key', 'ACTIVE_WINDOW': 'Active Window',
    'SCREENSHOT': 'Screenshot', 'LAYER_TRANSITION': 'Transitions',
    'DOLPHIN': 'Dolphin', 'KONSOLE': 'Konsole', 'SYSTEMBAR': 'System Bar',
    'CAVA': 'Audio Visualizer', 'FN_LAYER': 'Fn Layer', 'FN_KEYS': 'Fn Keys',
    'CUSTOM_LAYER': 'Custom Layer',
}

SECTION_DESCS = {
    'DISPLAY': 'Screen timing and brightness',
    'SLEEP': 'Touch Bar behavior around system sleep',
    'LAYER_TRANSITION': 'Timing for switching between layers',
    'DOCK': "Pinned apps and the dock's appearance",
    'DEFAULT_BROWSER_KEYS': 'Shortcuts sent to any browser window',
    'BROWSER_KEY_OVERRIDES': 'Per-browser shortcut overrides',
    'DEFAULT_VSCODE_KEYS': 'Shortcuts sent to any VS Code window',
    'VSCODE_KEY_OVERRIDES': 'Per-editor shortcut overrides',
    'ESC_KEY': 'The on-screen Esc key for wide Touch Bars',
    'ACTIVE_WINDOW': 'How the focused window is detected',
    'SCREENSHOT': 'Touch Bar screenshot shortcut',
    'DOLPHIN': 'Dolphin file manager panel',
    'KONSOLE': 'Konsole terminal panel',
    'SYSTEMBAR': 'CPU, memory, and network stats',
    'CAVA': 'Audio visualizer bars',
    'FN_LAYER': 'How the Fn key reaches the F-key layer',
    'FN_KEYS': 'Extra keys shown after F1–F12 in the Fn-key layer',
    'CUSTOM_LAYER': 'Drag widgets onto the physical Touch Bar via the bridge.',
}

UNION_FIELDS = {
    'ESC_KEY.onLayers': ['all', 'fn'],
    'ACTIVE_WINDOW.backend': ['auto', 'hyprland', 'niri', 'gnome', 'plasma', 'xorg'],
    'FN_LAYER.mode': ['hold', 'toggle', 'double-tap'],
    'DOCK.shortcut.mode': ['hold', 'toggle', 'double-tap'],
}

ICON_CHOICES = [
    'FaFolder', 'FaFolderOpen', 'FaTerminal', 'FaFirefoxBrowser', 'FaChrome',
    'FaCode', 'FaMusic', 'FaGithub', 'FaGitlab', 'FaGear', 'FaImage',
    'FaFile', 'FaFilePdf', 'FaEnvelope', 'FaCalendar', 'FaCamera',
    'FaVideo', 'FaDiscord', 'FaSlack', 'FaSpotify', 'FaSteam',
    'FaDocker', 'FaLinux', 'FaGlobe', 'FaDownload', 'FaPrint',
]

WIDGET_PALETTE = [
    ('activewindow', 'Active Window'), ('clock', 'Clock'),
    ('capslock', 'Caps Lock'), ('separator', 'Separator'),
    ('clipboard', 'Clipboard'),
]

#: Default on-bar width per widget type (mirrors CUSTOM_WIDGET_WIDTHS in
#: src/custom-layer/types.ts) — used for palette/ghost tile sizes so each
#: chip previews at its real footprint.
WIDGET_DEFAULT_WIDTHS = {
    'clock': 72, 'weather': 64, 'cpu': 60, 'battery': 64,
    'capslock': 60, 'mic': 40, 'ram': 60, 'cava': 46,
    'activewindow': 170, 'separator': 10, 'clipboard': 100,
}
WIDGET_LABELS = dict(WIDGET_PALETTE)

def humanize(key: str) -> str:
    out = re.sub(r'([a-z])([A-Z])', r'\1 \2', key)
    return out[:1].upper() + out[1:]


def scalar(v) -> str:
    """Stringify a JSON scalar for display in entries/combos."""
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, str):
        return v
    if isinstance(v, float) and v == float('inf'):
        return 'Infinity'
    if isinstance(v, (int, float)):
        return num_str(v)
    return str(v)


def num_str(n: float) -> str:
    if n == float('inf'):
        return 'Infinity'
    if n == int(n) and abs(n) < 1e15:
        return str(int(n))
    return repr(n)


def combo_display(codes) -> str:
    codes = list(codes)
    if not codes:
        return '(click to set)'
    return ' + '.join(CODE_TO_KEY_NAME.get(int(c), str(int(c))) for c in codes)


def unique_app_id(base: str, existing) -> str:
    taken = {a.obj.get('id') for a in existing if isinstance(a.obj, dict)}
    if base not in taken:
        return base
    n = 2
    while f'{base}-{n}' in taken:
        n += 1
    return f'{base}-{n}'

# ── Paths ────────────────────────────────────────────────────────────────────


def home() -> str:
    sudo_user = os.environ.get('SUDO_USER')
    if sudo_user:
        return f'/home/{sudo_user}'
    return os.environ.get('HOME', '/root')


def default_repo_dir() -> str:
    env = os.environ.get('REACT_DRM_REPO_DIR')
    if env:
        return env
    return os.path.join(home(), 'react-drm', 'linux-touchbar-control-center')


class ConfigPaths:
    def __init__(self, repo_dir: str):
        self.repo_dir = repo_dir

    @property
    def config_path(self):
        return os.path.join(self.repo_dir, 'config.ts')

    @property
    def blueprint_path(self):
        return os.path.join(self.repo_dir, 'config.blueprint.ts')


def ensure_config_exists(paths: ConfigPaths):
    if os.path.exists(paths.config_path):
        return
    if not os.path.exists(paths.blueprint_path):
        raise RuntimeError(
            f"blueprint not found at {paths.blueprint_path} — is the repo path correct?")
    with open(paths.blueprint_path) as f, open(paths.config_path, 'w') as g:
        g.write(f.read())

# ── TypeScript mini-scanner ──────────────────────────────────────────────────
# Tokenizes just enough TS to find `const NAME = {...}` object literals and
# their property spans. Comments are consumed (positions kept) so splices
# never land inside them unintentionally.

TOKEN_RE = re.compile(r'''
    (?P<ws>\s+)
  | (?P<comment>//[^\n]*|/\*.*?\*/)
  | (?P<str>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)
  | (?P<num>\d[\w.]*)
  | (?P<ident>[A-Za-z_$][\w$]*)
  | (?P<punct>.)
''', re.X | re.S)


class Tok:
    __slots__ = ('kind', 'text', 'start', 'end')

    def __init__(self, kind, text, start, end):
        self.kind, self.text, self.start, self.end = kind, text, start, end

    def matches(self, kind, text=None):
        return self.kind == kind and (text is None or self.text == text)

    def ident(self):
        return self.text if self.kind == 'ident' else None


def tokenize(src: str):
    toks = []
    for m in TOKEN_RE.finditer(src):
        kind = m.lastgroup
        if kind in ('ws', 'comment'):
            continue
        toks.append(Tok(kind, m.group(), m.start(), m.end()))
    return toks


class Unsupported(Exception):
    pass


def _unquote(raw: str):
    if raw.startswith('`'):
        inner = raw[1:-1]
        return None if '${' in inner else inner.replace('\\`', '`').replace('\\\\', '\\')
    body = raw[1:-1]
    # JSON-style unescape covers our writer; passes through common escapes.
    try:
        s = json.loads('"' + body.replace('"', '\\"') + '"')
        return s
    except Exception:
        return body


def parse_value_tokens(toks):
    """(value, elements) from a token slice. elements aligns with list items
    (ObjLit per `{}` element, else None); None for non-arrays."""
    if not toks:
        raise Unsupported()
    t0 = toks[0]

    def single(v):
        return v, None

    if len(toks) == 1:
        if t0.kind == 'num':
            txt = t0.text
            f = float(txt)
            v = int(f) if ('.' not in txt and 'e' not in txt.lower()) else f
            return single(v)
        if t0.kind == 'str':
            v = _unquote(t0.text)
            if v is None:
                raise Unsupported()
            return single(v)
        if t0.kind == 'ident':
            if t0.text == 'true':
                return single(True)
            if t0.text == 'false':
                return single(False)
            if t0.text == 'null':
                return single(None)
            if t0.text == 'Infinity':
                return single(float('inf'))
            raise Unsupported()
    if (len(toks) == 3 and toks[0].matches('ident', 'KEY') and toks[1].text == '.'
            and toks[2].kind == 'ident'):
        name = toks[2].text
        if name in KEY:
            return single(KEY[name])
        raise Unsupported()
    if t0.text == '[':
        values, elements = [], []
        i = 1
        while i < len(toks) and toks[i].text != ']':
            if toks[i].text == ',':
                i += 1
                continue
            # element slice until matching , or ]
            depth = 0
            j = i
            while j < len(toks):
                tj = toks[j]
                if tj.text in '{[':
                    depth += 1
                elif tj.text in '}]':
                    if depth == 0:
                        break
                    depth -= 1
                elif tj.text == ',' and depth == 0:
                    break
                j += 1
            elem_toks = slice_span_toks(toks, toks[i].start, toks[j].start if toks[j].text in ',]' else toks[j].end)
            v, _ = parse_value_tokens(elem_toks)
            el_node = None
            if elem_toks and elem_toks[0].text == '{':
                el_node, _ = ObjLit.parse_at(elem_toks, 0)
            values.append(v)
            elements.append(el_node)
            i = j
        return values, elements
    if t0.text == '{':
        node, _ = ObjLit.parse_at(toks, 0)
        return single(node.to_plain())
    raise Unsupported()


class Prop:
    __slots__ = ('key', 'vstart', 'vend', 'value', 'child', 'cast', 'elements')

    def __init__(self, key, vstart, vend, value, child, cast):
        self.key, self.vstart, self.vend = key, vstart, vend
        self.value, self.child, self.cast = value, child, cast
        self.elements = None  # list of ObjLit|None for array props


class ObjLit:
    """Parsed `{ ... }` literal: ordered props with source spans."""

    def __init__(self, start, end, props):
        self.start, self.end = start, end   # char offsets of { and }+1
        self.props = props                   # OrderedDict[str -> Prop]

    @staticmethod
    def parse_at(toks, i, src=None):
        """toks[i] must be '{'. Returns (ObjLit, index after matching '}')."""
        start_ch = toks[i].start
        i += 1
        props = {}
        cast_span_holder = []
        while True:
            if i >= len(toks):
                raise Unsupported('unbalanced braces')
            if toks[i].text == '}':
                return ObjLit(start_ch, toks[i].end, props), i + 1
            if toks[i].text == ',':
                i += 1
                continue

            kt = toks[i]
            if kt.kind == 'ident':
                key = kt.text
            elif kt.kind == 'str':
                key = _unquote(kt.text)
            else:
                raise Unsupported(f'bad prop key {kt.text!r}')
            i += 1
            if i >= len(toks) or toks[i].text != ':':
                raise Unsupported(f'expected : after {key!r}')
            i += 1

            vstart = toks[i].start
            depth = 0
            j = i
            cast = None
            as_idx = None
            while j < len(toks):
                tj = toks[j]
                if tj.text in '{[':
                    depth += 1
                elif tj.text in '}]':
                    if depth == 0:
                        break
                    depth -= 1
                elif tj.text == ',' and depth == 0:
                    break
                elif tj.kind == 'ident' and tj.text == 'as' and depth == 0:
                    # `<expr> as Type` — remember the RAW type slice.
                    as_idx = j
                    k = j + 1
                    tdepth = 0
                    while k < len(toks):
                        tk2 = toks[k]
                        if tk2.text in '{[(':
                            tdepth += 1
                        elif tk2.text in '}])':
                            if tdepth == 0:
                                break
                            tdepth -= 1
                        elif tk2.text == ',' and tdepth == 0:
                            break
                        k += 1
                    lo = toks[j + 1].start if j + 1 < len(toks) else vend
                    hi = toks[k - 1].end if k > j + 1 else vend
                    cast_span_holder.append((lo, hi))
                    j = k
                    break
                j += 1
            vend = toks[j].start if j < len(toks) and toks[j].text in ',}' else (
                toks[-1].end if not (j < len(toks)) else toks[j].end)

            if cast_span_holder:
                lo, hi = cast_span_holder.pop()
                cast = src[lo:hi] if src else ' '.join(t.text for t in toks if lo <= t.start < hi)
            # The VALUE ends where `as` begins — the raw vend span still
            # contains the `as Type` text and must not reach the parser.
            vtoks = slice_span_toks(
                toks, vstart, toks[as_idx].start if as_idx is not None else vend)
            child = None
            if vtoks and vtoks[0].text == '{':
                try:
                    child, _ = ObjLit.parse_at(vtoks, 0, src)
                    value = child.to_plain()
                except Unsupported:
                    # Skip this property like nodeToValue's None contract.
                    if j < len(toks) and toks[j].text == '}':
                        return ObjLit(start_ch, toks[j].end, props), j + 1
                    i = j
                    if i < len(toks) and toks[i].text == ',':
                        i += 1
                    continue
                elements = None
            else:
                try:
                    value, elements = parse_value_tokens(vtoks)
                except Unsupported:
                    if j < len(toks) and toks[j].text == '}':
                        return ObjLit(start_ch, toks[j].end, props), j + 1
                    i = j
                    if i < len(toks) and toks[i].text == ',':
                        i += 1
                    continue

            prop = Prop(key, vstart, vend, value, child, cast)
            prop.elements = elements
            props[key] = prop

            if j < len(toks) and toks[j].text == '}':
                return ObjLit(start_ch, toks[j].end, props), j + 1
            i = j
            if i < len(toks) and toks[i].text == ',':
                i += 1

    def to_plain(self):
        return {k: p.value for k, p in self.props.items()}


def slice_span_toks(toks, start_ch, end_ch):
    """Tokens fully inside [start,end), keeping ABSOLUTE offsets so nested
    ObjLit nodes carry usable splice spans."""
    out = []
    for t in toks:
        if t.end <= start_ch:
            continue
        if t.start >= end_ch:
            break
        out.append(t)
    return out


_find_section_src = {}


def find_section(toks, name):
    """Locates `[export] const NAME ...= {...}`; returns ObjLit or None."""
    for i in range(len(toks) - 3):
        if not toks[i].matches('ident', 'const'):
            continue
        # optional `export` before is irrelevant; match the NAME after const
        j = i + 1
        if j >= len(toks) or toks[j].kind != 'ident':
            continue
        if toks[j].text != name:
            # allow `const NAME: Type = {` handled below by name check only
            continue
        # skip to '=' at depth 0 (skips type annotations incl braces)
        depth = 0
        k = j + 1
        while k < len(toks):
            t = toks[k]
            if t.text in '{[(':
                depth += 1
            elif t.text in '}])':
                depth -= 1
            elif t.text == '=' and depth == 0 and toks[k + 1].text != '=':
                break
            elif t.text == ';' and depth == 0:
                break
            k += 1
        if k >= len(toks) or toks[k].text != '=':
            continue
        k += 1
        if k < len(toks) and toks[k].text == '{':
            node, _end = ObjLit.parse_at(toks, k, _find_section_src.get('src'))
            return node
    return None

# ── Reading ──────────────────────────────────────────────────────────────────


def read_sections(src: str):
    _find_section_src['src'] = src
    toks = tokenize(src)
    out = {}
    for name in SECTION_NAMES:
        node = find_section(toks, name)
        if node is not None:
            try:
                out[name] = node.to_plain()
            except Unsupported:
                continue
    return out, toks


def _ident_text(src, start, end):
    seg = src[start:end]
    m = re.fullmatch(r'\s*([A-Za-z_$][\w$]*)\s*', seg)
    return m.group(1) if m else None


def attach_dock_glyphs(src: str, toks, sections):
    """DOCK.apps[].icon holds a react-icons ident — surface it as iconGlyph."""
    dock = find_section(toks, 'DOCK')
    if dock is None or 'DOCK' not in sections:
        return
    apps_prop = dock.props.get('apps')
    if apps_prop is None or not apps_prop.elements:
        return
    arr = sections['DOCK'].get('apps')
    if not isinstance(arr, list):
        return
    # `icon:` idents are UNSUPPORTED values (skipped by the parser), so scan
    # each element's raw span instead of relying on parsed props.
    icon_re = re.compile(r'(?<![\w$])icon\b\s*:\s*([A-Za-z_$][\w$]*)')
    for i, el in enumerate(apps_prop.elements):
        if el is None or i >= len(arr) or not isinstance(arr[i], dict):
            continue
        m = icon_re.search(src[el.start:el.end])
        if m:
            arr[i]['iconGlyph'] = m.group(1)


def with_defaults(defaults, overrides):
    if overrides is None:
        return defaults
    if isinstance(defaults, dict) and isinstance(overrides, dict):
        merged = dict(overrides)
        for k, dv in defaults.items():
            merged[k] = with_defaults(dv, overrides.get(k))
        return merged
    return overrides


def read_config(config_path, blueprint_path):
    with open(config_path) as f:
        user_src = f.read()
    with open(blueprint_path) as f:
        bp_src = f.read()

    user_sections, user_toks = read_sections(user_src)
    bp_sections, bp_toks = read_sections(bp_src)

    attach_dock_glyphs(user_src, user_toks, user_sections)
    attach_dock_glyphs(bp_src, bp_toks, bp_sections)

    result = OrderedDict(user_sections)
    for name in SECTION_NAMES:
        if name in bp_sections:
            result[name] = with_defaults(bp_sections[name], user_sections.get(name))
    return result

# ── Writing ──────────────────────────────────────────────────────────────────


def quote(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def safe_key(k: str) -> str:
    if re.fullmatch(r'[A-Za-z_$][\w$]*', k):
        return k
    return quote(k)


def render(v, in_array=False) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float) and v == float('inf'):
        return 'Infinity'
    if isinstance(v, int):
        if in_array:
            name = CODE_TO_KEY_NAME.get(v)
            if name:
                return f'KEY.{name}'
        return str(v)
    if isinstance(v, float):
        return num_str(v)
    if isinstance(v, str):
        return quote(v)
    if isinstance(v, list):
        return '[' + ', '.join(render(x, True) for x in v) + ']'
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{safe_key(k)}: {render(x)}' for k, x in v.items()) + ' }'
    raise Unsupported(repr(v))


class Patch:
    __slots__ = ('start', 'end', 'text')

    def __init__(self, start, end, text):
        self.start, self.end, self.text = start, end, text


def line_indent(src, offset):
    ls = src.rfind('\n', 0, offset) + 1
    line = src[ls:]
    return line[:len(line) - len(line.lstrip())]


def prev_meaningful_byte(src, pos):
    """Byte before `pos`, skipping whitespace and // comments."""
    while pos > 0:
        c = src[pos - 1]
        if c.isspace():
            pos -= 1
            continue
        ls = src.rfind('\n', 0, pos) + 1
        seg = src[ls:pos]
        r = seg.rfind('//')
        if r != -1 and not seg[r + 2:].strip():
            pos = ls + r
            continue
        return src[pos - 1]
    return None


def flush_insertions(src, node, inserts, patches):
    if not inserts:
        return
    close_off = node.end - 1  # index of '}'
    brace_indent = line_indent(src, close_off)
    if node.props:
        last = list(node.props.values())[-1]
        prop_indent = line_indent(src, last.vstart)
        prev = prev_meaningful_byte(src, close_off)
        needs_comma = prev not in (',', '{')
        empty = False
    else:
        prop_indent = brace_indent + '    '
        needs_comma = False
        empty = True

    lines = ''.join(
        f'\n{prop_indent}{safe_key(k)}: {rendered},' for k, rendered in inserts)
    text = ('\n' if empty else (',' if needs_comma else '')) + lines
    if empty:
        text = '\n' + lines
    # always re-close on its own line
    if text.endswith(','):
        text = text[:-1]
    text += '\n' + brace_indent
    inserts.clear()
    patches.append(Patch(close_off, close_off, text))


def deep_eq(a, b):
    return a == b and type(a) == type(b)


def patch_object(src, node, new_value, patches, special=()):
    inserts = []
    for key, value in new_value.items():
        if key in special:
            continue
        prop = node.props.get(key)
        if prop is not None:
            if prop.child is not None and isinstance(value, dict):
                patch_object(src, prop.child, value, patches)
                continue
            if deep_eq(prop.value, value):
                continue
            text = render(value)
            if prop.cast:
                text += f' as {prop.cast}'
            patches.append(Patch(prop.vstart, prop.vend, text))
        else:
            inserts.append((key, render(value)))
    flush_insertions(src, node, inserts, patches)


def _apply_patches(src, patches):
    """Applies byte-range patches back-to-front; asserts no overlaps."""
    patches.sort(key=lambda p: p.start, reverse=True)
    for a, b in zip(patches, patches[1:]):
        if b.end > a.start:
            raise RuntimeError('internal error: overlapping config patches')
    out = src
    for pt in patches:
        out = out[:pt.start] + pt.text + out[pt.end:]
    return out


def patch_dock_apps(src, dock_node, new_apps, patches, icon_names):
    apps_prop = dock_node.props.get('apps')
    if apps_prop is None:
        # No apps array — insert a fresh one before the closing brace.
        parts = [render_new_app(a, icon_names) for a in new_apps]
        close_off = dock_node.end - 1
        if dock_node.props:
            indent = line_indent(src, list(dock_node.props.values())[-1].vstart)
            prev = prev_meaningful_byte(src, close_off)
            comma = '' if prev in (',', '{') else ','
        else:
            indent = line_indent(src, dock_node.start) + '    '
            comma = ''
        text = f'{comma}\n{indent}apps: [{", ".join(parts)}],'
        patches.append(Patch(close_off, close_off, text))
        return

    elements = apps_prop.elements or []
    existing_ids = []
    for el in elements:
        pid = el.props.get('id') if el else None
        existing_ids.append(pid.value if pid and isinstance(pid.value, str) else None)

    def split_cast_text(prop):
        return f' as {prop.cast}' if prop.cast else ''

    new_ids = [a.obj.get('id') if isinstance(a.obj, dict) else None for a in new_apps]
    same_order = (len(elements) == len(new_ids)
                  and all(e == n for e, n in zip(existing_ids, new_ids)))

    any_change = False
    final_texts = {}

    for i, app in enumerate(new_apps):
        aid = app.obj.get('id')
        glyph = app.icon_glyph
        rest = OrderedDict((k, v) for k, v in app.obj.items() if k != 'iconGlyph')

        matched = next((e for e, eid in zip(elements, existing_ids) if eid == aid), None)
        if matched is not None:
            local = []
            patch_object(src, matched, rest, local)
            elem_text = src[matched.start:matched.end]
            m_icon = re.search(r'(?<![\w$])icon\b\s*:\s*([A-Za-z_$][\w$]*)', elem_text)
            current_icon = m_icon.group(1) if m_icon else None
            if glyph and current_icon != glyph:
                icon_names.add(glyph)
                if m_icon:
                    lo = matched.start + m_icon.start(1)
                    hi = matched.start + m_icon.end(1)
                    local.append(Patch(lo, hi, glyph))
                else:
                    close_off = matched.end - 1
                    ind = line_indent(src, matched.start) + '    '
                    prev = prev_meaningful_byte(src, close_off)
                    comma = '' if prev in (',', '{', ':') else ','
                    local.append(Patch(close_off, close_off,
                                       f'{comma}\n{ind}icon: {glyph},\n'))
            if any(p.text != src[p.start:p.end] or p.start != p.end for p in local):
                any_change = True
            # Simulate this element's own patches onto its slice.
            text = src[matched.start:matched.end]
            local.sort(key=lambda pp: pp.start, reverse=True)
            base = matched.start
            for pp in sorted(local, key=lambda pp: pp.start, reverse=True):
                s0, e0 = pp.start - base, pp.end - base
                text = text[:s0] + pp.text + text[e0:]
            final_texts[i] = text
        else:
            any_change = True
            final_texts[i] = render_new_app(app, icon_names)

    if same_order and not any_change:
        return  # untouched — preserve original formatting

    parts = []
    for i, app in enumerate(new_apps):
        t = final_texts.get(i)
        if t is None:
            t = render(app.obj)  # unchanged original element
        parts.append(t)

    cast_suffix = split_cast_text(apps_prop)
    arr_text = '[\n    ' + ',\n    '.join(parts) + ',\n  ]' + cast_suffix
    patches.append(Patch(apps_prop.vstart, apps_prop.vend, arr_text))


def render_new_app(app, icon_names):
    entries = []
    for k, v in app.obj.items():
        if k == 'iconGlyph':
            continue
        entries.append(f'{safe_key(k)}: {render(v)}')
    glyph = app.icon_glyph
    if glyph:
        entries.append(f'icon: {glyph}')
        icon_names.add(glyph)
    return '{ ' + ', '.join(entries) + ' }'


def ensure_fa6_imports(src, toks, icon_names):
    if not icon_names:
        return None
    names = set(icon_names)
    # Find `import { ... } from "react-icons/fa6";`
    for i in range(len(toks) - 4):
        if toks[i].matches('ident', 'import'):
            j = i + 1
            if j < len(toks) and toks[j].text == '{':
                k = j + 1
                depth = 1
                while k < len(toks) and depth:
                    if toks[k].text == '{':
                        depth += 1
                    elif toks[k].text == '}':
                        depth -= 1
                    elif depth == 1 and toks[k].kind == 'ident':
                        names.add(toks[k].text)
                    k += 1
                # find `from` then module string
                m = k
                while m < len(toks) and not (toks[m].matches('ident', 'from')):
                    m += 1
                if m + 1 < len(toks) and toks[m + 1].kind == 'str':
                    mod = _unquote(toks[m + 1].text)
                    if mod == 'react-icons/fa6':
                        first, last = j + 1, k - 2
                        lo = toks[first].start if first <= last else (
                            toks[j].end)
                        hi = toks[last].end if first <= last else toks[j].end
                        ordered = ', '.join(sorted(names))
                        return Patch(lo, hi, ordered)
    prepend = 'import { ' + ', '.join(sorted(names)) + ' } from "react-icons/fa6";\n'
    return Patch(0, 0, prepend)


def sync_compiled_config(config_path):
    """Best-effort dist/config.js refresh via the repo's own typescript."""
    d = os.path.dirname(config_path)
    dist_dir = os.path.join(d, 'dist')
    if not os.path.isdir(dist_dir):
        return
    script = (
        "const ts=require('typescript'),fs=require('fs'),p=require('path');"
        "const f=p.resolve(process.argv[1]);"
        "const o=ts.transpileModule(fs.readFileSync(f,'utf8'),"
        "{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,"
        "esModuleInterop:true},fileName:f});"
        "fs.writeFileSync(p.join(p.dirname(f),'dist',p.basename(f,'.ts')+'.js'),o.outputText);"
    )
    try:
        subprocess.run(['node', '-e', script, config_path],
                       cwd=d, capture_output=True, timeout=30)
    except Exception:
        pass


class AppEntry:
    """One DOCK.apps entry during writing."""

    def __init__(self, obj):
        self.obj = obj

    @property
    def icon_glyph(self):
        g = self.obj.get('iconGlyph')
        return g if isinstance(g, str) and g else None


def write_config(config_path, sections):
    with open(config_path) as f:
        src = f.read()
    _find_section_src['src'] = src
    toks = tokenize(src)
    patches = []
    icon_names = set()

    for name in SECTION_NAMES:
        value = sections.get(name)
        if not isinstance(value, dict):
            continue
        node = find_section(toks, name)
        if node is None:
            continue
        if name == 'DOCK':
            plain = {k: v for k, v in value.items() if k != 'apps'}
            patch_object(src, node, plain, patches)
            apps = value.get('apps')
            if isinstance(apps, list):
                entries = [AppEntry(OrderedDict(x) if isinstance(x, dict) else x) for x in apps]
                patch_dock_apps(src, node, entries, patches, icon_names)
        else:
            patch_object(src, node, value, patches)

    ip = ensure_fa6_imports(src, toks, icon_names)
    if ip:
        patches.append(ip)

    out = _apply_patches(src, patches)
    with open(config_path, 'w') as f:
        f.write(out)
    sync_compiled_config(config_path)


# ── Desktop applications ─────────────────────────────────────────────────────

APP_DIRS = [
    os.path.join(home(), '.local/share/applications'),
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    os.path.join(home(), '.local/share/flatpak/exports/share/applications'),
]


class DesktopApp:
    __slots__ = ('name', 'command', 'args', 'icon')

    def __init__(self, name, command, args, icon):
        self.name, self.command, self.args, self.icon = name, command, args, icon


def _split_exec(exec_line):
    tokens, cur, q = [], '', False
    i = 0
    while i < len(exec_line):
        ch = exec_line[i]
        if ch == '"':
            q = not q
        elif ch == '\\' and i + 1 < len(exec_line):
            cur += exec_line[i + 1]
            i += 1
        elif not q and ch.isspace():
            if cur:
                tokens.append(cur)
                cur = ''
        else:
            cur += ch
        i += 1
    if cur:
        tokens.append(cur)
    return tokens


def parse_desktop_entry(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
    except OSError:
        return None
    in_entry = False
    name = exec_line = icon = None
    no_display = hidden = False
    is_app = True
    for raw in text.split('\n'):
        line = raw.strip()
        if line.startswith('['):
            in_entry = line == '[Desktop Entry]'
            continue
        if not in_entry or '=' not in line:
            continue
        key, _, val = line.partition('=')
        key, val = key.strip(), val.strip()
        if key == 'Name' and name is None:
            name = val
        elif key == 'Exec':
            exec_line = val
        elif key == 'Icon':
            icon = val
        elif key == 'NoDisplay':
            no_display = val.lower() == 'true'
        elif key == 'Hidden':
            hidden = val.lower() == 'true'
        elif key == 'Type':
            is_app = val == 'Application'
    if not name or not exec_line or no_display or hidden or not is_app:
        return None
    toks = [t for t in _split_exec(exec_line)
            if not (len(t) == 2 and t.startswith('%') and t[1].isalpha())]
    if not toks:
        return None
    return DesktopApp(name, toks[0], toks[1:], icon)


def list_desktop_apps():
    seen, apps = set(), []
    for d in APP_DIRS:
        try:
            entries = os.listdir(d)
        except OSError:
            continue
        for fn in sorted(entries):
            if not fn.endswith('.desktop') or fn in seen:
                continue
            app = parse_desktop_entry(os.path.join(d, fn))
            if app:
                seen.add(fn)
                apps.append(app)
    apps.sort(key=lambda a: a.name.lower())
    return apps


ICON_BASES = [
    os.path.join(home(), '.local/share/icons'),
    os.path.join(home(), '.icons'),
    '/usr/share/icons',
    '/usr/local/share/icons',
]


def list_icon_themes():
    seen = set()
    for base in ICON_BASES:
        try:
            for name in os.listdir(base):
                if os.path.exists(os.path.join(base, name, 'index.theme')):
                    seen.add(name)
        except OSError:
            pass
    return sorted(seen)


_ICON_CACHE = {}


def resolve_icon_file(name):
    """freedesktop icon probe mirroring src/appIcon.ts."""
    if name in _ICON_CACHE:
        return _ICON_CACHE[name]

    def hit(path):
        _ICON_CACHE[name] = path
        return path

    if os.path.isabs(name) and os.path.exists(name):
        return hit(name)

    override = getattr(resolve_icon_file, '_theme', None)
    theme = override or _ini(home() + '/.config/kdeglobals', 'Icons', 'Theme') \
        or _ini(home() + '/.config/gtk-4.0/settings.ini', 'Settings', 'gtk-icon-theme-name') \
        or _ini(home() + '/.config/gtk-3.0/settings.ini', 'Settings', 'gtk-icon-theme-name') \
        or 'hicolor'
    chain = []
    for t in [theme, 'breeze', 'Papirus', 'Adwaita', 'hicolor']:
        if t not in chain:
            chain.append(t)
    sizes = [64, 48, 96, 128, 32, 256, 512, 24, 22, 16]
    for th in chain:
        for base in ICON_BASES:
            d = os.path.join(base, th)
            cands = [os.path.join(d, 'scalable/apps', name + ext) for ext in ('.svg',)]
            cands += [os.path.join(d, 'apps/scalable', name + ext) for ext in ('.svg',)]
            for s in sizes:
                cands.append(os.path.join(d, 'apps', str(s), name + '.svg'))
            for s in sizes:
                cands.append(os.path.join(d, f'{s}x{s}', 'apps', name + '.svg'))
            for s in sizes:
                cands.append(os.path.join(d, f'{s}x{s}', 'apps', name + '.png'))
            cands += [
                os.path.join(d, 'scalable/apps', f'{name}-symbolic.svg'),
                os.path.join(d, 'apps/scalable', f'{name}-symbolic.svg'),
            ]
            for c in cands:
                if os.path.exists(c):
                    return hit(c)
    for ext in ('.svg', '.png'):
        p = f'/usr/share/pixmaps/{name}{ext}'
        if os.path.exists(p):
            return hit(p)
    _ICON_CACHE[name] = None
    return None


def set_icon_theme(theme):
    resolve_icon_file._theme = theme
    _ICON_CACHE.clear()


def _ini(path, section, key):
    try:
        with open(path) as f:
            txt = f.read()
    except OSError:
        return None
    in_sec = False
    want = f'[{section.lower()}]'
    for raw in txt.split('\n'):
        line = raw.strip()
        if line.startswith('['):
            in_sec = line.lower() == want
            continue
        if in_sec and '=' in line:
            k, _, v = line.partition('=')
            if k.strip() == key:
                return v.strip()
    return None


# ══════════════════════════════════════════════════════════════════════════════
# GTK UI
# ══════════════════════════════════════════════════════════════════════════════

CSS = b"""
/* Old-Unity-launcher look: neutral dark glass, Ubuntu orange accents.
   The toplevel itself must not paint: the theme default is opaque. */
window { background: transparent; }
.root { background: linear-gradient(180deg, rgba(44,44,47,0.60) 0%, rgba(19,19,21,0.72) 100%); }
.topbar { background: rgba(0,0,0,0.18); padding: 8px 12px; }
.navbar { background: rgba(0,0,0,0.28); padding: 5px 10px; }
.logo-chip { background: #E95420; border-radius: 3px; padding: 2px 7px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
.logo-chip label { color:#ffffff; font-weight:800; font-size:11px; }
.app-title { color:#f4f4f2; font-weight:700; font-size:13px; }
.status { border-radius:11px; padding:2px 11px; font-size:11px; color:#b8b8b8; }
.status.ok { background:rgba(120,190,120,.14); color:#8fd48f; }
.status.err { background:rgba(233,84,32,.18); color:#F89B57; }
button.primary { background: linear-gradient(180deg,#EF7832,#DD4814); color:#ffffff;
  font-weight:700; border-radius:4px; padding:5px 15px; border:none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }
button.primary:disabled { opacity:.45; }
button.primary:hover { background: linear-gradient(180deg,#F58949,#E95420); }
button.ghost { background:rgba(255,255,255,0.04); color:#e8e8e6; border-radius:4px;
  padding:4px 12px; border:1px solid rgba(255,255,255,0.12); font-size:12px; }
button.ghost:hover { background:rgba(255,255,255,0.10); }
button.danger { background:transparent; color:#e07a5f; border-radius:4px;
  padding:2px 10px; font-size:11px; border:1px solid rgba(224,122,95,.3); }
button.danger:hover { background:rgba(224,122,95,.12); }
button.win-close { background:rgba(255,255,255,0.06); border:none; border-radius:4px;
  padding:4px 9px; color:#c9c9c9; }
button.win-close:hover { background:#E95420; color:#fff; }
entry.search { background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.10);
  border-radius:4px; padding:5px 10px; color:#f4f4f2; min-width:210px; }
entry.search:focus { border-color:#E95420; }
.section-title { color:#f4f4f2; font-size:22px; font-weight:800; }
.section-desc { color:#b0b0ae; font-size:12px; }
.accent-bar { background:linear-gradient(90deg,#E95420,#F89B57); border-radius:2px;
  min-height:3px; }
.group-header { color:#F89B57; font-size:10px; font-weight:800; margin-top:18px;
  margin-bottom:4px; letter-spacing:1px; }
.field-label { color:#c2c2c0; font-size:12px; }
.field-label.dim { color:#8a8a88; font-size:11px; }
row-field { border-bottom:1px solid rgba(255,255,255,0.06); padding:9px 2px; min-height:20px; }
entry.field { background:rgba(0,0,0,0.30); border:1px solid rgba(255,255,255,0.10);
  border-radius:4px; padding:4px 9px; color:#f4f4f2; min-width:190px; }
entry.mono { font-family:monospace; font-size:12px; }
entry.field:focus { border-color:#E95420; background:rgba(0,0,0,0.45); }
.card { background:rgba(255,255,255,0.055); border:1px solid rgba(255,255,255,0.08);
  border-radius:6px; padding:16px; margin-bottom:14px; }
.override-card { background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.06);
  border-radius:6px; padding:13px 15px; margin-bottom:12px; }
.override-class { font-family:monospace; font-weight:600; color:#F89B57; font-size:13px; }
.key-capture { background:rgba(0,0,0,0.30); border:1px solid rgba(255,255,255,0.10);
  border-radius:4px; padding:4px 12px; font-family:monospace; font-size:11px; color:#f4f4f2; }
.key-capture.listening { background:rgba(233,84,32,.16); border-color:#E95420; color:#F89B57; }
.nav-item { background:transparent; border:none; border-radius:4px; padding:8px 15px; }
.nav-item label { color:#d2d2d0; font-size:9.5px; font-weight:700; }
.nav-item:hover { background:rgba(255,255,255,0.09); }
.nav-item.active { background:rgba(233,84,32,0.24);
  box-shadow: inset 0 -2px 0 #E95420; }
.nav-item.active label { color:#ffd9c4; }
.preview-caption { color:#8f8f8d; font-size:10.5px; margin-top:5px; }
.chip { background:rgba(255,255,255,0.055); border:1px solid rgba(255,255,255,0.12);
  border-radius:4px; padding:8px 15px; font-weight:600; font-size:12px; color:#f0f0ee; }
.chip:hover { border-color:#E95420; background:rgba(233,84,32,0.10); }
.chip:active { background:rgba(233,84,32,0.22); }
/* Placeholder tiles: quiet, flat, consistent with the panel's cards.
   The button is the widget's real footprint; content is centred. */
.chip-ph { padding:0; min-width:0; min-height:0;
  background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.09);
  border-radius:6px;
  color:#ececea; }
.chip-ph label { font-size:11px; font-weight:600; padding:0 4px; }
.chip-ph:hover { background:rgba(255,255,255,0.12);
  border-color:rgba(233,84,32,0.65); }
.chip-ph:active { background:rgba(233,84,32,0.20); }
.conn-ok { color:#8fd48f; font-size:12px; font-weight:600; }
.conn-err { color:#F89B57; font-size:12px; font-weight:600; }
.cl-hint { color:#8f8f8d; font-size:11px; }
.drag-ghost { background:rgba(25,25,27,0.95); border:1px solid #E95420;
  border-radius:5px; padding:5px 12px; color:#F89B57; font-weight:700; font-size:12px; }
.empty-state { color:#b8b8b6; font-size:13px; padding:40px 20px; }
popover.bubble { background:rgba(25,25,27,0.97); border:1px solid rgba(255,255,255,0.10);
  border-radius:8px; padding:0; }
popover.bubble list row { padding:7px 12px; border-radius:5px; }
popover.bubble list row:hover { background:rgba(255,255,255,0.08); }
combobox button { background:rgba(0,0,0,0.30); color:#f4f4f2;
  border:1px solid rgba(255,255,255,0.10); border-radius:4px; padding:3px 8px; }
combobox entry { background:rgba(0,0,0,0.30); color:#f4f4f2; }
button:focus { outline: 2px solid #F89B57; outline-offset: -2px; }
.nav-item:focus { outline-color: #F89B57; background: rgba(255,255,255,0.09); }
.chip:focus, .key-capture:focus, button.win-close:focus, button.danger:focus {
  outline: 2px solid #F89B57; outline-offset: -2px; }
checkbutton:focus, switch:focus, spinbutton:focus, scale:focus {
  outline: 2px solid #F89B57; outline-offset: -2px; }
"""


WINDOW_HEIGHT_FRACTION = 0.85


class BridgeClient:
    """Unix-socket bridge client: reader thread → GLib.idle callbacks."""

    def __init__(self, on_event):
        self.on_event = on_event
        self.sock = None

    @staticmethod
    def socket_path():
        runtime = os.environ.get('XDG_RUNTIME_DIR') or os.environ.get('TMPDIR') or '/tmp'
        return os.path.join(runtime, 'react-drm-custom-layer.sock')

    def start(self):
        import threading
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self):
        while True:
            try:
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.connect(self.socket_path())
                self._emit({'type': 'conn', 'ok': True})
                buf = b''
                while True:
                    chunk = self.sock.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
                    while b'\n' in buf:
                        line, buf = buf.split(b'\n', 1)
                        if not line.strip():
                            continue
                        try:
                            msg = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        self._emit(msg)
            except OSError:
                pass
            self.sock = None
            self._emit({'type': 'conn', 'ok': False})
            import time
            time.sleep(2)

    def _emit(self, msg):
        GLib.idle_add(self.on_event, msg)

    def send(self, obj):
        s = self.sock
        if not s:
            return
        try:
            s.sendall((json.dumps(obj) + '\n').encode())
        except OSError:
            pass


def set_icon_theme_for_preview(theme):
    set_icon_theme(theme)


# ── Main application window ──────────────────────────────────────────────────


class ConfigGUI:
    def __init__(self, repo_dir):
        self.paths = ConfigPaths(repo_dir)
        self.state = {}
        self.dirty = False
        self.current = ''
        self.capture = None          # dict(path, index, codes, label_widget)
        self.cl_state = {'widgets': [], 'dirty': False, 'bar_w': 2008.0}
        self.cl_slot = None          # CL tab widgets when open
        self.icon_cache = {}

        ensure_config_exists(self.paths)
        self.state = read_config(self.paths.config_path, self.paths.blueprint_path)
        self.themes = list_icon_themes()

        self.bridge = BridgeClient(self._on_bridge_event)
        self.bridge.start()
        self.bridge_ok = None
        self._dnd_state = None

        self.win = Gtk.Window()
        self.win.set_title('Touch Bar Config')
        self.win.set_default_size(1280, 700)

        if not os.environ.get('CONFIG_GUI_DESKTOP'):
            try:
                GtkLayerShell.init_for_window(self.win)
                GtkLayerShell.set_layer(self.win, GtkLayerShell.Layer.TOP)
                GtkLayerShell.set_keyboard_mode(
                    self.win, GtkLayerShell.KeyboardMode.ON_DEMAND)
                GtkLayerShell.set_namespace(self.win, 'touchbar-config')
                for e in (GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT,
                          GtkLayerShell.Edge.RIGHT):
                    GtkLayerShell.set_anchor(self.win, e, True)
                GtkLayerShell.set_exclusive_zone(self.win, -1)
                monitor_geo = self._monitor_geometry()
                panel_h = int(monitor_geo.height * WINDOW_HEIGHT_FRACTION)
                self.win.set_size_request(-1, panel_h)
                # Sit flush above the Touch Bar dock strip (preview app or
                # the react-drm bar) instead of overlapping it.
                mon_w = getattr(monitor_geo, 'width', 0) or 1920
                strip_h = os.environ.get('CONFIG_GUI_BOTTOM_MARGIN')
                if strip_h is None:
                    import subprocess as _sp
                    running = _sp.run(['pgrep', '-f', 'gtk_layer_app.py'],
                                      capture_output=True).returncode == 0
                    strip_h = str(int(round(
                        (mon_w - 2 * 10) / (2008 / 60)) + 6) if running else 0)
                GtkLayerShell.set_margin(self.win, GtkLayerShell.Edge.BOTTOM,
                                         int(strip_h))
            except Exception as e:
                print('layer-shell unavailable:', e)

        # Translucency: pick the screen's RGBA visual so alpha in the CSS is
        # honoured by the compositor (same recipe as preview-app).
        rgba_visual = self.win.get_screen().get_rgba_visual()
        if rgba_visual is not None:
            self.win.set_visual(rgba_visual)
        self.win.set_app_paintable(True)

        provider = Gtk.CssProvider()
        provider.load_from_data(CSS.decode() if isinstance(CSS, bytes) else CSS)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        root.get_style_context().add_class('root')

        root.pack_start(self._build_header(), False, False, 0)
        root.pack_start(self._build_content(), True, True, 0)
        root.pack_end(self._build_nav(), False, False, 0)

        overlay = Gtk.Overlay()
        overlay.add(root)
        self.fixed = Gtk.Fixed()
        self.ghost = Gtk.Label(label='')
        self.ghost.get_style_context().add_class('drag-ghost')
        self.ghost.set_no_show_all(True)
        self.fixed.put(self.ghost, 0, 0)
        overlay.add_overlay(self.fixed)
        # The Fixed must never intercept input: without this it eats every
        # click meant for the UI underneath (verified via minimal repro).
        self.fixed.set_has_window(False)
        overlay.set_overlay_pass_through(self.fixed, True)
        self.fixed.set_can_focus(False)

        self.win.add(overlay)

        self.win.connect('key-press-event', self._on_key_press)
        self.win.connect('destroy', Gtk.main_quit)
        self.win.show_all()

        first = next((s for s in SECTION_NAMES if s in self.state), 'DISPLAY')
        self.switch_section(first)
        first_btn = self.nav_buttons.get(first)
        if first_btn:
            first_btn.grab_focus()

    def _monitor_geometry(self):
        disp = Gdk.Display.get_default()
        mon = disp.get_monitor_at_window(self.win.get_window()) if self.win.get_window() else disp.get_primary_monitor()
        return mon.get_geometry() if mon else type('G', (), {'height': 1080})()

    # ── header ──
    def _build_header(self):
        hb = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        hb.get_style_context().add_class('topbar')

        chip = Gtk.Label(label='▁▃▅')
        chip.get_style_context().add_class('logo-chip')
        hb.pack_start(chip, False, False, 0)

        title = Gtk.Label(label='Touch Bar Config')
        title.get_style_context().add_class('app-title')
        hb.pack_start(title, False, False, 0)

        self.search = Gtk.SearchEntry()
        self.search.get_style_context().add_class('search')
        self.search.set_placeholder_text('Search settings…')
        self.search.connect('search-changed', self._on_search)
        hb.pack_start(self.search, False, False, 0)

        spacer = Gtk.Box()
        spacer.set_hexpand(True)
        hb.pack_start(spacer, True, True, 0)

        self.status_lbl = Gtk.Label(label='')
        self.status_lbl.get_style_context().add_class('status')
        hb.pack_start(self.status_lbl, False, False, 0)

        self.restart_btn = Gtk.Button(label='Restart service')
        self.restart_btn.get_style_context().add_class('ghost')
        self.restart_btn.set_visible(False)
        self.restart_btn.connect('clicked', self._on_restart)
        hb.pack_start(self.restart_btn, False, False, 0)

        save = Gtk.Button(label='Save')
        save.get_style_context().add_class('primary')
        save.connect('clicked', self._on_save)
        hb.pack_start(save, False, False, 0)

        close = Gtk.Button(label='✕')
        close.get_style_context().add_class('win-close')
        close.connect('clicked', lambda *_: self.win.close())
        hb.pack_start(close, False, False, 0)
        return hb

    # ── content / nav ──
    def _build_content(self):
        self.content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.content.set_margin_top(24)
        self.content.set_margin_bottom(48)
        self.content.set_margin_start(28)
        self.content.set_margin_end(28)
        self.content.set_halign(Gtk.Align.CENTER)
        self.content.set_valign(Gtk.Align.START)
        self.content.set_size_request(660, -1)
        sc = Gtk.ScrolledWindow()
        sc.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        sc.set_vexpand(True)
        sc.add(self.content)
        return sc

    def _visible_sections(self):
        out = [s for s in SECTION_NAMES if s in self.state]
        out.append('CUSTOM_LAYER')
        return out

    def _build_nav(self):
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        bar.get_style_context().add_class('navbar')
        # Span the full panel width...
        bar.set_hexpand(True)
        bar.set_halign(Gtk.Align.FILL)
        self.nav_buttons = {}
        # ...with the items themselves centred: equal expanding spacers.
        lead = Gtk.Box()
        lead.set_hexpand(True)
        bar.pack_start(lead, True, True, 0)
        for key in self._visible_sections():
            btn = Gtk.Button(label=SECTION_LABELS[key])
            btn.get_style_context().add_class('nav-item')
            btn.connect('clicked', self._make_nav_cb(key))
            self.nav_buttons[key] = btn
            bar.pack_start(btn, False, False, 0)
        trail = Gtk.Box()
        trail.set_hexpand(True)
        bar.pack_start(trail, True, True, 0)
        return bar

    def _make_nav_cb(self, key):
        def cb(*_):
            self.switch_section(key)
        return cb

    def _on_search(self, entry):
        q = entry.get_text().strip().lower()
        for key, btn in self.nav_buttons.items():
            lbl = SECTION_LABELS[key].lower()
            btn.set_visible(not q or q in lbl)

    # ── status ──
    def set_status(self, text, kind='idle'):
        ctx = self.status_lbl.get_style_context()
        for c in ('ok', 'err'):
            ctx.remove_class(c)
        if kind == 'ok':
            ctx.add_class('ok')
        elif kind == 'err':
            ctx.add_class('err')
        self.status_lbl.set_text(text)

    def mark_dirty(self):
        self.dirty = True
        self.set_status('Unsaved changes')

    # ── section switching ──
    def switch_section(self, key):
        self.current = key
        for k, btn in self.nav_buttons.items():
            btn.get_style_context().remove_class('active')
            if k == key:
                btn.get_style_context().add_class('active')

        for ch in self.content.get_children():
            self.content.remove(ch)
        self.cl_slot = None

        title = Gtk.Label(label=SECTION_LABELS.get(key, key))
        title.get_style_context().add_class('section-title')
        title.set_halign(Gtk.Align.START)
        desc = Gtk.Label(label=SECTION_DESCS.get(key, ''))
        desc.get_style_context().add_class('section-desc')
        desc.set_halign(Gtk.Align.START)
        bar = Gtk.Box()
        bar.set_size_request(44, 3)
        bar.get_style_context().add_class('accent-bar')
        bar.set_halign(Gtk.Align.START)
        for w in (title, desc, bar):
            self.content.pack_start(w, False, False, 4 if w is not desc else 6)

        if key == 'CUSTOM_LAYER':
            self._build_custom_layer(self.content)
        elif key == 'DOCK':
            self._build_dock(self.content)
        elif key in ('DEFAULT_BROWSER_KEYS', 'DEFAULT_VSCODE_KEYS'):
            self._build_keymap(key, self.content)
        elif key in ('BROWSER_KEY_OVERRIDES', 'VSCODE_KEY_OVERRIDES'):
            self._build_overrides(key, self.content)
        elif key == 'FN_KEYS':
            self._build_fnkeys(self.content)
        else:
            sec = self.state.get(key)
            if isinstance(sec, dict):
                self._build_generic_rows(key, sec, self.content)

        self.content.show_all()

    # ── generic rows ──
    def _field_row(self, label_text):
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        row.get_style_context().add_class('row-field')
        lbl = Gtk.Label(label=label_text)
        lbl.get_style_context().add_class('field-label')
        lbl.set_halign(Gtk.Align.START)
        lbl.set_hexpand(True)
        row.pack_start(lbl, True, True, 0)
        return row

    @staticmethod
    def _is_visual_path(path):
        return (path.startswith('DOCK.panel') or path.startswith('DOCK.indicator')
                or path in ('DOCK.iconSize', 'DOCK.gap', 'DOCK.icons.theme'))

    def _edited(self, path, value):
        self._set_path(path, value)
        self.mark_dirty()
        if self.current == 'DOCK' and self._is_visual_path(path):
            self.preview_area.queue_draw()

    def _set_path(self, path, value):
        parts = path.split('.')
        cur = self.state.setdefault(parts[0], {})
        for part in parts[1:-1]:
            cur = cur.setdefault(part, {})
        cur[parts[-1]] = value

    def _build_generic_rows(self, prefix, obj, container, skip=()):
        for key, val in obj.items():
            if key in skip:
                continue
            path = f'{prefix}.{key}'
            if isinstance(val, dict):
                gh = Gtk.Label(label=humanize(key))
                gh.get_style_context().add_class('group-header')
                gh.set_halign(Gtk.Align.START)
                container.pack_start(gh, False, False, 2)
                self._build_generic_rows(path, val, container)
                continue

            choices = UNION_FIELDS.get(path)
            is_theme = path == 'DOCK.icons.theme'
            row = self._field_row(humanize(key))

            if isinstance(val, bool):
                sw = Gtk.Switch(active=val)
                sw.set_valign(Gtk.Align.CENTER)
                sw.connect('notify::active', lambda sw_, p=path: self._edited(p, sw_.get_active()))
                row.pack_end(sw, False, False, 0)
            elif choices or is_theme:
                combo = Gtk.ComboBoxText()
                items = (['Auto-detect'] + list(dict.fromkeys(
                    [self.state['DOCK'].get('icons', {}).get('theme') or '']
                    + self.themes)) if is_theme else list(choices))
                items = [i for i in items if i != ''] if is_theme else items
                for it in items:
                    combo.append_text(it)
                display = ('Auto-detect' if is_theme and not scalar(val)
                           else scalar(val))
                combo.set_active(items.index(display) if display in items else 0)
                def on_sel(c, p=path, its=items, th=is_theme):
                    t = c.get_active_text()
                    v = None if (th and t == 'Auto-detect') else t
                    if v is not None:
                        self._edited(p, v)
                combo.connect('changed', on_sel)
                combo.set_halign(Gtk.Align.END)
                row.pack_end(combo, False, False, 0)
            elif isinstance(val, (int, float)) and not isinstance(val, bool):
                e = Gtk.Entry()
                e.get_style_context().add_class('mono')
                e.set_text(num_str(val))
                e.set_size_request(190, -1)
                e.set_halign(Gtk.Align.END)
                e.set_input_purpose(Gtk.InputPurpose.NUMBER)
                def commit(en, p=path):
                    raw = en.get_text().strip().lower()
                    try:
                        n = float('inf') if raw == 'infinity' else float(raw)
                        if n != n:
                            return
                    except ValueError:
                        return
                    self._edited(p, int(n) if float(n).is_integer() else float(n))
                e.connect('activate', commit)
                e.connect('focus-out-event',
                          lambda en, ev, cb=commit: (cb(en), False)[1])
                row.pack_end(e, False, False, 0)
            elif isinstance(val, list):
                e = Gtk.Entry()
                e.get_style_context().add_class('mono')
                e.set_text(', '.join(scalar(x) for x in val))
                e.set_size_request(220, -1)
                e.set_halign(Gtk.Align.END)
                e.connect('changed', lambda en, p=path: self._csv_changed(p, en))
                row.pack_end(e, False, False, 0)
            else:
                e = Gtk.Entry()
                e.set_text(scalar(val))
                e.set_size_request(220, -1)
                e.set_halign(Gtk.Align.END)
                e.connect('changed', lambda en, p=path: self._edited(p, en.get_text()))
                row.pack_end(e, False, False, 0)

            container.pack_start(row, False, False, 0)

    def _csv_changed(self, path, entry):
        arr = [s.strip() for s in entry.get_text().split(',') if s.strip()]
        self._set_path(path, arr)
        self.mark_dirty()

    # ── key capture ──
    def _key_capture_button(self, display, path, index=-1):
        btn = Gtk.Button(label=display)
        btn.get_style_context().add_class('key-capture')

        def clicked(*_):
            if self.capture:
                old = self.capture
                old['label_widget'].get_style_context().remove_class('listening')
                old['label_widget'].set_label('(click to set)')
            btn.set_label('Press keys… (Enter confirm · Esc cancel)')
            btn.get_style_context().add_class('listening')
            self.capture = {'path': path, 'index': index, 'codes': [], 'label_widget': btn}
            self.win.grab_focus()
        btn.connect('clicked', clicked)
        return btn

    def _on_key_press(self, win, event):
        if not self.capture:
            return self._on_global_key(win, event)
        cap = self.capture
        keyname = Gdk.keyval_name(event.keyval)
        if keyname in ('Return', 'KP_Enter'):
            codes = cap['codes']
            win.get_style_context()  # noop keepalive
            self._commit_capture(cap, codes)
            return True
        if keyname == 'Escape':
            cap['label_widget'].get_style_context().remove_class('listening')
            cap['label_widget'].set_label('(click to set)')
            self.capture = None
            return True
        state = event.state
        code = None
        if state & Gdk.ModifierType.CONTROL_MASK:
            code = 29
        elif state & Gdk.ModifierType.MOD1_MASK:
            code = 56
        elif state & Gdk.ModifierType.SHIFT_MASK:
            code = 42
        elif state & Gdk.ModifierType.SUPER_MASK:
            code = 125
        else:
            # evdev scancode = hardware_keycode − 8 on Linux
            ev = event.hardware_keycode - 8
            special = {'Left': 105, 'Right': 106, 'Up': 103, 'Down': 108,
                       'Home': 102, 'Page_Up': 104, 'Page_Down': 109,
                       'BackSpace': 14, 'Delete': 111, 'Tab': 15,
                       'F5': 63, 'F10': 68, 'F11': 87, 'grave': 41}
            if keyname in special:
                code = special[keyname]
            elif len(keyname) == 1 and keyname.isalpha():
                letter = keyname.lower()
                m = {'b': 48, 'f': 33, 'h': 35, 'p': 25, 'r': 19,
                     's': 31, 't': 20, 'w': 17, 'z': 44}
                if letter in m:
                    code = m[letter]
            elif keyname == 'comma':
                code = 51
            elif code is None and 0 < ev < 248 and ev in CODE_TO_KEY_NAME:
                code = ev
        if code is None:
            return True
        if code not in cap['codes']:
            cap['codes'].append(code)
            cap['label_widget'].set_label(
                ' + '.join(CODE_TO_KEY_NAME.get(c, str(c)) for c in cap['codes']) + ' …')
        return True

    def _on_global_key(self, win, event):
        """Keyboard-only operation: Esc closes, ←/→ switch sections, Ctrl+F search."""
        keyname = Gdk.keyval_name(event.keyval)
        if keyname == 'f' and event.state & Gdk.ModifierType.CONTROL_MASK:
            self.search.grab_focus()
            return True
        if keyname == 'Escape':
            if self._dnd_state:
                self._dnd_finish(cancel=True)
                return True
            win.close()
            return True
        if keyname in ('Left', 'Right'):
            focused = win.get_focus()
            if isinstance(focused, Gtk.Entry):
                return False
            order = self._visible_sections()
            cur = order.index(self.current) if self.current in order else -1
            step = 1 if keyname == 'Right' else -1
            self.switch_section(order[(cur + step) % len(order)])
            return True
        return False

    def _commit_capture(self, cap, codes):
        cap['label_widget'].get_style_context().remove_class('listening')
        self.capture = None
        if not codes:
            cap['label_widget'].set_label('(click to set)')
            return
        cap['label_widget'].set_label(
            ' + '.join(CODE_TO_KEY_NAME.get(c, str(c)) for c in codes))
        if cap['path'] == 'FN_KEYS.extra' and cap['index'] >= 0:
            extra = self.state.get('FN_KEYS', {}).get('extra', [])
            i = cap['index']
            if i < len(extra):
                extra[i]['key'] = codes[-1]
        else:
            self._set_path(cap['path'], codes)
        self.mark_dirty()

    def _build_keymap(self, section, container):
        sec = self.state.get(section, {})
        for action in (['back', 'forward', 'reload', 'home', 'newTab',
                        'closeTab', 'nextTab', 'prevTab']
                       if section.startswith('DEFAULT_BROWSER')
                       else ['back', 'forward', 'prevEditor', 'nextEditor',
                             'toggleSidebar', 'toggleTerminal', 'run', 'stop',
                             'stepOver', 'stepInto', 'stepOut', 'undo', 'redo',
                             'find', 'replace', 'commandPalette', 'settings']):
            if action not in sec:
                continue
            row = self._field_row(humanize(action))
            row.pack_end(self._key_capture_button(
                combo_display(sec[action]), f'{section}.{action}'), False, False, 0)
            container.pack_start(row, False, False, 0)

    def _build_overrides(self, section, container):
        sec = self.state.setdefault(section, {})
        actions = (['back', 'forward', 'reload', 'home', 'newTab', 'closeTab',
                    'nextTab', 'prevTab']
                   if section.startswith('BROWSER')
                   else ['back', 'forward', 'prevEditor', 'nextEditor',
                         'toggleSidebar', 'toggleTerminal', 'run', 'stop',
                         'stepOver', 'stepInto', 'stepOut', 'undo', 'redo',
                         'find', 'replace', 'commandPalette', 'settings'])
        for wclass, partial in sec.items():
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            card.get_style_context().add_class('override-card')
            head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
            t = Gtk.Label(label=wclass)
            t.get_style_context().add_class('override-class')
            t.set_halign(Gtk.Align.START)
            t.set_hexpand(True)
            head.pack_start(t, True, True, 0)
            rm = Gtk.Button(label='Remove')
            rm.get_style_context().add_class('danger')
            rm.connect('clicked', lambda b, c=wclass, cd=card:
                       self._remove_override(section, c, cd))
            head.pack_end(rm, False, False, 0)
            card.pack_start(head, False, False, 2)

            for action in actions:
                codes = partial.get(action, [])
                row = self._field_row(humanize(action))
                lblc = row.get_children()[0]
                lblc.get_style_context().add_class('dim')
                row.pack_end(self._key_capture_button(
                    combo_display(codes), f'{section}.{wclass}.{action}'),
                    False, False, 0)
                card.pack_start(row, False, False, 0)
            container.pack_start(card, False, False, 6)

        addrow = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        addrow.set_margin_top(12)
        entry = Gtk.Entry()
        entry.get_style_context().add_class('mono')
        entry.set_placeholder_text('window class, e.g. firefox')
        addrow.pack_start(entry, False, False, 0)
        add = Gtk.Button(label='+ Add override')
        add.get_style_context().add_class('ghost')

        def on_add(*_):
            cls = entry.get_text().strip().lower()
            if not cls or cls in self.state.get(section, {}):
                return
            entry.set_text('')
            self.state.setdefault(section, {})[cls] = {}
            self.mark_dirty()
            self.switch_section(section)
        add.connect('clicked', on_add)
        entry.connect('activate', on_add)
        addrow.pack_start(add, False, False, 0)
        container.pack_start(addrow, False, False, 0)

    def _remove_override(self, section, wclass, card):
        self.state.get(section, {}).pop(wclass, None)
        self.mark_dirty()
        parent = card.get_parent()
        if parent:
            parent.remove(card)

    def _build_fnkeys(self, container):
        extra = self.state.setdefault('FN_KEYS', {}).setdefault('extra', [])

        def rerender():
            self.switch_section('FN_KEYS')

        for i, entry in enumerate(list(extra)):
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
            row.get_style_context().add_class('row-field')
            le = Gtk.Entry()
            le.set_text(scalar(entry.get('label')))
            le.set_placeholder_text('label')
            le.set_size_request(140, -1)
            le.connect('changed', lambda en, idx=i: self._fnkey_label(idx, en))
            row.pack_start(le, False, False, 0)
            row.pack_end(self._key_capture_button(
                combo_display([entry.get('key', 0)]), 'FN_KEYS.extra', i),
                False, False, 0)
            rm = Gtk.Button(label='Remove')
            rm.get_style_context().add_class('danger')
            rm.connect('clicked', lambda b, idx=i: self._fnkey_remove(idx))
            row.pack_end(rm, False, False, 0)
            container.pack_start(row, False, False, 0)

        add = Gtk.Button(label='+ Add key')
        add.get_style_context().add_class('ghost')
        add.set_halign(Gtk.Align.START)
        add.set_margin_top(12)
        esc = KEY.get('ESC', 1)

        def on_add(*_):
            extra.append({'label': 'key', 'key': esc})
            self.mark_dirty()
            rerender()
        add.connect('clicked', on_add)
        container.pack_start(add, False, False, 0)

    def _fnkey_label(self, idx, entry):
        extra = self.state.get('FN_KEYS', {}).get('extra', [])
        if idx < len(extra):
            extra[idx]['label'] = entry.get_text()
            self.mark_dirty()

    def _fnkey_remove(self, idx):
        extra = self.state.get('FN_KEYS', {}).get('extra', [])
        if idx < len(extra):
            extra.pop(idx)
            self.mark_dirty()
            self.switch_section('FN_KEYS')

    # ── DOCK tab ──
    def _build_dock(self, container):
        dock = self.state.setdefault('DOCK', {})
        theme = (dock.get('icons') or {}).get('theme')
        set_icon_theme_for_preview(theme if isinstance(theme, str) and theme else None)

        self.preview_area = Gtk.DrawingArea()
        self.preview_area.set_hexpand(True)
        self.preview_area.set_size_request(-1, 58)
        self.preview_area.connect('draw', self._draw_preview)
        pv = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        pv.pack_start(self.preview_area, False, False, 0)
        cap = Gtk.Label(label='Live preview — reflects the settings below as you change them')
        cap.get_style_context().add_class('preview-caption')
        cap.set_halign(Gtk.Align.START)
        pv.pack_start(cap, False, False, 0)
        container.pack_start(pv, False, False, 8)

        plain = {k: v for k, v in dock.items() if k != 'apps'}
        self._build_generic_rows('DOCK', plain, container, skip=())

        head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        head.set_margin_top(20)
        t = Gtk.Label(label='Apps')
        t.get_style_context().add_class('app-title')
        head.pack_start(t, False, False, 0)
        spacer = Gtk.Box()
        spacer.set_hexpand(True)
        head.pack_start(spacer, True, True, 0)
        addbtn = Gtk.Button(label='+ Add app')
        addbtn.get_style_context().add_class('primary')
        addbtn.connect('clicked', self._open_picker)
        head.pack_end(addbtn, False, False, 0)
        container.pack_start(head, False, False, 6)

        self.apps_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        container.pack_start(self.apps_box, False, False, 0)
        self._render_app_cards()
        self.preview_area.queue_draw()

    def _dock_apps(self):
        return self.state.setdefault('DOCK', {}).setdefault('apps', [])

    def _render_app_cards(self):
        for ch in self.apps_box.get_children():
            self.apps_box.remove(ch)
        for idx, app in enumerate(self._dock_apps()):
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=7)
            card.get_style_context().add_class('card')

            head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            glyph_combo = Gtk.ComboBoxText()
            for g in ICON_CHOICES:
                glyph_combo.append_text(g)
            glyph = app.get('iconGlyph') or ICON_CHOICES[0]
            glyph_combo.set_active(ICON_CHOICES.index(glyph) if glyph in ICON_CHOICES else 0)
            glyph_combo.set_size_request(150, -1)

            def on_glyph(c, i=idx):
                apps = self._dock_apps()
                if i < len(apps):
                    sel = c.get_active_text() or ICON_CHOICES[0]
                    apps[i]['iconGlyph'] = sel
                    self.mark_dirty()
            glyph_combo.connect('changed', on_glyph)
            head.pack_start(glyph_combo, False, False, 0)

            id_e = Gtk.Entry()
            id_e.get_style_context().add_class('mono')
            id_e.set_placeholder_text('id')
            id_e.set_text(scalar(app.get('id')))
            id_e.set_hexpand(True)
            id_e.connect('changed', lambda en, i=idx: self._app_field(i, 'id', en.get_text()))
            head.pack_start(id_e, True, True, 0)

            rm = Gtk.Button(label='Remove')
            rm.get_style_context().add_class('danger')
            rm.connect('clicked', lambda b, i=idx: self._app_remove(i))
            head.pack_end(rm, False, False, 0)
            card.pack_start(head, False, False, 0)

            fields = [('label', 'Label', False), ('iconName', 'Theme icon name', True),
                      ('color', 'Fallback color', True), ('command', 'Command', True),
                      ('args', 'Launch args (csv)', True),
                      ('matchClass', 'Match classes (csv)', True)]
            for key, lbl_text, mono in fields:
                fr = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
                l = Gtk.Label(label=lbl_text)
                l.get_style_context().add_class('field-label')
                l.add_css_class = None
                ctx = l.get_style_context()
                ctx.remove_class('field-label'); ctx.add_class('field-label dim')
                l.set_size_request(148, -1)
                l.set_halign(Gtk.Align.START)
                fr.pack_start(l, False, False, 0)
                e = Gtk.Entry()
                if mono:
                    e.get_style_context().add_class('mono')
                val = app.get(key, [])
                e.set_text(', '.join(val) if isinstance(val, list) else scalar(val))
                e.set_hexpand(True)
                e.connect('changed', lambda en, i=idx, k=key: self._app_field_csv(i, k, en))
                fr.pack_end(e, True, True, 0)
                card.pack_start(fr, False, False, 0)

            self.apps_box.pack_start(card, False, False, 4)

    def _app_field(self, idx, key, value):
        apps = self._dock_apps()
        if idx < len(apps):
            apps[idx][key] = value
            self.mark_dirty()

    def _app_field_csv(self, idx, key, entry):
        text = entry.get_text()
        apps = self._dock_apps()
        if idx >= len(apps):
            return
        if key in ('args', 'matchClass'):
            arr = [s.strip() for s in text.split(',') if s.strip()]
            apps[idx][key] = arr
        else:
            apps[idx][key] = text
        self.mark_dirty()

    def _app_remove(self, idx):
        apps = self._dock_apps()
        if idx < len(apps):
            apps.pop(idx)
            self.mark_dirty()
            self._render_app_cards()

    # ── app picker popover ──
    def _open_picker(self, btn):
        pop = Gtk.Popover()
        pop.get_style_context().add_class('bubble')
        pop.set_relative_to(btn)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        search = Gtk.SearchEntry()
        search.set_placeholder_text('Search installed apps…')
        box.pack_start(search, False, False, 4)
        sc = Gtk.ScrolledWindow()
        sc.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        sc.set_min_content_height(300)
        sc.set_min_content_width(400)
        lst = Gtk.ListBox()
        sc.add(lst)
        box.pack_start(sc, True, True, 0)
        custom = Gtk.Button(label='Add a custom app instead')
        custom.get_style_context().add_class('ghost')
        custom.set_margin_top(4)
        custom.set_margin_bottom(6)
        box.pack_start(custom, False, False, 0)
        pop.add(box)

        allapps = list_desktop_apps()

        def fill(q=''):
            for ch in lst.get_children():
                lst.remove(ch)
            ql = q.strip().lower()
            for a in [a for a in allapps if not ql or ql in a.name.lower()][:300]:
                r = Gtk.ListBoxRow()
                r.add(Gtk.Label(label=a.name, xalign=0))
                r._app = a
                lst.add(r)
                r.show_all()
        fill()

        def on_search(en):
            fill(en.get_text())
        search.connect('search-changed', on_search)

        def on_row_activated(_lst, row):
            a = getattr(row, '_app', None)
            if a:
                self._picked_app(a.name, a.command, a.args, a.icon)
            pop.popdown()
        lst.connect('row-activated', on_row_activated)

        def on_custom(*_):
            self._picked_app('New App', '', [], None)
            pop.popdown()
        custom.connect('clicked', on_custom)

        box.show_all()
        pop.popup()
        search.grab_focus()

    def _picked_app(self, name, command, args, icon):
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'app'
        aid = unique_app_id(slug, [type('A', (), {'obj': a})() for a in self._dock_apps()])
        entry = {'id': aid, 'label': name,
                 'iconGlyph': ICON_CHOICES[0], 'color': '#7dd3fc',
                 'command': command}
        if icon:
            entry['iconName'] = icon
        if args:
            entry['args'] = args
        self._dock_apps().append(entry)
        self.mark_dirty()
        self._render_app_cards()
        self.preview_area.queue_draw()

    # ── Dock preview drawing ──
    def _draw_preview(self, area, cr):
        dock = self.state.get('DOCK', {})
        panel = dock.get('panel') or {}
        indicator = dock.get('indicator') or {}
        w, h = area.get_allocated_width(), area.get_allocated_height()
        scale = area.get_scale_factor()

        color = _cairo_color(panel.get('color', '#1c1f26'))
        radius = min(16.0, float(panel.get('radius', 20)) / 3.0) * scale
        cr.set_source_rgba(*color)
        _rounded_rect(cr, 1, 1, w - 2, h - 2, radius)
        cr.fill()

        icon_size = float(dock.get('iconSize', 50))
        gap = float(dock.get('gap', 2))
        ind_size = float(indicator.get('size', 5))
        ind_color = indicator.get('color', '#7dd3fc')

        tile = h * icon_size / 60.0
        dot = h * ind_size / 60.0
        gap_px = max(2.0, w * gap / 2008.0)
        apps = self._dock_apps()
        n = len(apps)
        if n == 0:
            return False
        total = n * tile + (n - 1) * gap_px
        cx = (w - total) / 2 + tile / 2

        for i, app in enumerate(apps):
            ix, iy = cx - tile / 2, (h - tile - dot - h * 0.06) / 2
            name = app.get('iconName')
            pixbuf = self._load_icon(name, int(tile * scale)) if name else None
            if pixbuf:
                pw = pixbuf.get_width() / scale
                ph = pixbuf.get_height() / scale
                s = min(tile / pw, tile / ph)
                dw, dh = pw * s, ph * s
                cr.save()
                _rounded_rect(cr, ix + (tile - dw) / 2, iy + (tile - dh) / 2,
                              dw, dh, tile * 0.22)
                cr.clip()
                Gdk.cairo_set_source_pixbuf(
                    cr, pixbuf, ix + (tile - dw) / 2, iy + (tile - dh) / 2)
                cr.paint()
                cr.restore()
            else:
                col = _cairo_color(app.get('color', '#7dd3fc'))
                cr.set_source_rgba(*col)
                _rounded_rect(cr, ix, iy, tile, tile, tile * 0.22)
                cr.fill()
                letter = (scalar(app.get('label'))[:1] or '?').upper()
                cr.set_source_rgba(*_cairo_color('#0c1116'))
                cr.select_font_face('Sans', 0, 1)
                fs = tile * 0.42
                cr.set_font_size(fs)
                ext = cr.text_extents(letter)
                cr.move_to(cx - ext.width / 2, iy + tile / 2 + ext.height / 2)
                cr.show_text(letter)

            if i == 0 and ind_color:
                cr.set_source_rgba(*_cairo_color(ind_color))
                dcy = iy + tile + h * 0.03
                cr.arc(cx, dcy, dot / 2, 0, 6.28318530718)
                cr.fill()
            cx += tile + gap_px
        return False

    def _load_icon(self, name, px):
        key = f'{name}@{px}'
        if key not in self.icon_cache:
            path = resolve_icon_file(name)
            pb = None
            if path:
                try:
                    from gi.repository import GdkPixbuf
                    pb = GdkPixbuf.Pixbuf.new_from_file_at_size(path, px, px)
                except Exception:
                    pb = None
            self.icon_cache[key] = pb
        return self.icon_cache[key]

    # ── Custom Layer tab ──
    def _build_custom_layer(self, container):
        conn = Gtk.Label(label='Checking Touch Bar…')
        conn.get_style_context().add_class('conn-err')
        conn.set_halign(Gtk.Align.START)
        # Reflect the CURRENT bridge state — events only flow on change, so
        # without this the label would sit at "Checking…" forever.
        if self.bridge_ok is True:
            conn.set_text('Connected to the Touch Bar')
            ctx = conn.get_style_context()
            ctx.add_class('conn-ok')
            ctx.remove_class('conn-err')
        elif self.bridge_ok is False:
            conn.set_text('Touch Bar not reachable — is react-drm running?')
        container.pack_start(conn, False, False, 4)

        pal_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        pal_card.get_style_context().add_class('override-card')
        pal_card.pack_start(Gtk.Label(label='Widget palette'), False, False, 0)

        flow = Gtk.FlowBox()
        flow.set_max_children_per_line(9)
        flow.set_selection_mode(Gtk.SelectionMode.NONE)
        # Tight packing — tiles sit edge-to-edge like on the real bar.
        flow.set_column_spacing(2)
        flow.set_row_spacing(4)
        for wtype, wlabel in WIDGET_PALETTE:
            # Chip = the widget's own look: your widget-{name} image,
            # cover-fitted into a widget-proportioned tile.
            chip = Gtk.Button()
            chip.get_style_context().add_class('chip-ph')
            tile_w = WIDGET_DEFAULT_WIDTHS.get(wtype, 100)
            # The Button itself IS the widget footprint: exact tile size,
            # always a text placeholder.
            chip.set_relief(Gtk.ReliefStyle.NONE)
            chip.set_size_request(tile_w, 50)
            lbl = Gtk.Label(label='|' if wtype == 'separator' else wlabel)
            lbl.set_ellipsize(3)  # PANGO_ELLIPSIZE_END
            chip.add(lbl)
            chip.set_tooltip_text(wlabel)
            # Mirror config-gui (Electron): the drag starts on press and is
            # tracked with a device grab — no click action, no gesture
            # threshold, nothing else can steal the sequence. Enter still
            # activates as a keyboard fallback that drops mid-bar.
            chip.connect('button-press-event', self._cl_chip_press, wtype, wlabel)
            chip.connect('clicked', self._cl_chip_activate, wtype)
            flow.add(chip)
        pal_card.pack_start(flow, False, False, 0)
        container.pack_start(pal_card, False, False, 4)

        hint = Gtk.Label(label='Drag a chip into the bottom band of this panel — it lands on '
                               'the physical Touch Bar right below. Long-press a widget on '
                               'the bar itself to reposition it.')
        hint.get_style_context().add_class('cl-hint')
        hint.set_halign(Gtk.Align.START)
        hint.set_line_wrap(True)
        container.pack_start(hint, False, False, 2)

        container.pack_start(Gtk.Label(label='On the Touch Bar'), False, False, 4)

        self.cl_slot = {
            'conn': conn,
            'list': Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5),
            'status': Gtk.Label(label=''),
            'save': None,
        }
        container.pack_start(self.cl_slot['list'], False, False, 0)

        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        controls.set_margin_top(8)
        self.cl_slot['status'].set_hexpand(True)
        controls.pack_start(self.cl_slot['status'], True, True, 0)
        reset = Gtk.Button(label='Reset')
        reset.get_style_context().add_class('ghost')
        reset.connect('clicked', lambda *_: self.bridge.send({'type': 'reset'}))
        controls.pack_end(reset, False, False, 0)
        save = Gtk.Button(label='Save layout')
        save.get_style_context().add_class('primary')
        save.set_sensitive(False)
        save.connect('clicked', lambda *_: self.bridge.send({'type': 'save'}))
        controls.pack_end(save, False, False, 0)
        self.cl_slot['save'] = save
        container.pack_start(controls, False, False, 0)

        self._render_cl_widgets()
        self.bridge.send({'type': 'requestState'})

    def _render_cl_widgets(self):
        if not self.cl_slot:
            return
        lst = self.cl_slot['list']
        for ch in lst.get_children():
            lst.remove(ch)
        widgets = self.cl_state['widgets']
        if not widgets:
            empty = Gtk.Label(label='Nothing placed yet.')
            empty.get_style_context().add_class('cl-hint')
            empty.set_halign(Gtk.Align.START)
            lst.pack_start(empty, False, False, 2)
        for w in widgets:
            if not isinstance(w, dict) or not w.get('id'):
                continue
            try:
                wx = round(float(w.get('x') or 0))
                ww = round(float(w.get('width') or 0))
            except (TypeError, ValueError):
                continue
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
            row.get_style_context().add_class('row-field')
            name = Gtk.Label(label=WIDGET_LABELS.get(w.get('type'), str(w.get('type'))))
            name.get_style_context().add_class('field-label')
            name.set_halign(Gtk.Align.START)
            name.set_hexpand(True)
            row.pack_start(name, True, True, 0)
            xpos = Gtk.Label(label=f'x: {wx}')
            xpos.get_style_context().add_class('cl-hint')
            row.pack_start(xpos, False, False, 0)
            wid = w['id']
            minus = Gtk.Button(label='−')
            minus.get_style_context().add_class('ghost')
            minus.connect('clicked', lambda b, i=wid, wd=ww:
                          self.bridge.send({'type': 'resize', 'id': i, 'width': wd - 10}))
            row.pack_start(minus, False, False, 0)
            wl = Gtk.Label(label=f'{ww}px')
            wl.get_style_context().add_class('cl-hint')
            row.pack_start(wl, False, False, 0)
            plus = Gtk.Button(label='+')
            plus.get_style_context().add_class('ghost')
            plus.connect('clicked', lambda b, i=wid, wd=ww:
                         self.bridge.send({'type': 'resize', 'id': i, 'width': wd + 10}))
            row.pack_start(plus, False, False, 0)
            rm = Gtk.Button(label='Remove')
            rm.get_style_context().add_class('danger')
            rm.connect('clicked', lambda b, i=wid: self.bridge.send({'type': 'remove', 'id': i}))
            row.pack_start(rm, False, False, 0)
            lst.pack_start(row, False, False, 0)
        dirty = self.cl_state['dirty']
        self.cl_slot['status'].set_text('Unsaved layout changes' if dirty else '')
        self.cl_slot['save'].set_sensitive(dirty)
        self.cl_slot['list'].show_all()

    def _on_bridge_event(self, msg):
        mtype = msg.get('type')
        if mtype == 'conn':
            self.bridge_ok = bool(msg['ok'])
            if self.cl_slot:
                c = self.cl_slot['conn']
                ctx = c.get_style_context()
                if msg['ok']:
                    c.set_text('Connected to the Touch Bar')
                    ctx.add_class('conn-ok'); ctx.remove_class('conn-err')
                else:
                    c.set_text('Touch Bar not reachable — is react-drm running?')
                    ctx.add_class('conn-err'); ctx.remove_class('conn-ok')
            return False
        if mtype == 'state':
            self.cl_state['widgets'] = msg.get('widgets', [])
            self.cl_state['dirty'] = bool(msg.get('dirty'))
            self.cl_state['bar_w'] = float(msg.get('barWidth', 2008))
            self._render_cl_widgets()
        elif mtype == 'error':
            print('[custom-layer]', msg.get('message'))
        return False

    # ── CL chip dragging (mirrors config-gui's editor.ts) ────────────────────

    #: The Touch Bar sits below the panel — once the pointer crosses the
    #: bottom edge, the item "is" on the bar: the local ghost vanishes and
    #: the bridge streams its position. Drag back up before releasing and it
    #: comes back; nothing commits unless release happens after a crossing.
    CL_EDGE_TOLERANCE_PX = 6

    def _cl_chip_press(self, btn, ev, wtype, wlabel):
        if ev.button != 1:
            return False
        # Returning True also suppresses the Button's click emission — a
        # press is always the start of a drag, like the Electron chips.
        self._dnd_begin(btn, ev.device, wtype, wlabel)
        return True

    def _dnd_begin(self, source, device, wtype, label):
        """Start a drag: grab the pointer so every motion/release arrives
        here until release, exactly like Electron's window-level listeners."""
        win_gdk = self.win.get_window()
        if not win_gdk:
            return
        mask = (Gdk.EventMask.BUTTON_PRESS_MASK
                | Gdk.EventMask.BUTTON_RELEASE_MASK
                | Gdk.EventMask.POINTER_MOTION_MASK
                | Gdk.EventMask.BUTTON1_MOTION_MASK)
        status = device.grab(win_gdk, Gdk.GrabOwnership.APPLICATION, False,
                             mask, None, Gdk.CURRENT_TIME)
        if status != Gdk.GrabStatus.SUCCESS:
            return
        px, py = self._dnd_pointer_local()
        self._dnd_state = {'device': device, 'wtype': wtype,
                           'on_bar': False, 'handlers': []}
        self.ghost.set_text(f'Dragging: {label}')
        self.ghost.show()
        self._dnd_place(px, py)
        # The grab redirects every device event to the toplevel window.
        for sig, cb in (('motion-notify-event', self._cl_drag_motion),
                        ('button-release-event', self._cl_drag_release)):
            self._dnd_state['handlers'].append(
                (self.win, self.win.connect(sig, cb)))

    def _dnd_pointer_local(self):
        dev = self._dnd_state['device'] if self._dnd_state else None
        seat = dev.get_seat() if dev else None
        pointer = seat.get_pointer() if seat else None
        if pointer:
            _win, px, py, _mask = self.win.get_window().get_device_position(pointer)
            return px, py
        return 0, 0

    def _dnd_place(self, gx, gy):
        self.fixed.move(self.ghost, int(gx), int(gy))

    def _dnd_update(self, gx, gy):
        """Shared per-move logic; coordinates are window-relative."""
        if not self._dnd_state:
            return
        win_w = max(1, self.win.get_allocated_width())
        win_h = max(1, self.win.get_allocated_height())
        now_on = gy >= win_h - self.CL_EDGE_TOLERANCE_PX
        st = self._dnd_state
        if now_on and not st['on_bar']:
            st['on_bar'] = True
            self.ghost.hide()
            self.bridge.send({'type': 'dragStart', 'widgetType': st['wtype']})
        elif not now_on and st['on_bar']:
            st['on_bar'] = False
            self.ghost.show()
            self.bridge.send({'type': 'dragEnd', 'commit': False})
        if st['on_bar']:
            self.bridge.send({'type': 'dragMove',
                              'x': min(1.0, max(0.0, gx / win_w))
                                   * self.cl_state['bar_w'], 'y': 0})
        else:
            self._dnd_place(gx, gy)

    def _cl_drag_motion(self, source, ev):
        if not self._dnd_state:
            return False
        # While grabbed, motion reports against the toplevel window even
        # when the pointer travels outside it — required for edge crossing.
        self._dnd_update(ev.x, ev.y)
        return True

    def _cl_drag_release(self, source, ev):
        was_on = bool(self._dnd_state and self._dnd_state['on_bar'])
        self._dnd_finish(cancel=not was_on)
        return True
        self._dnd_update(*self._dnd_pointer_local())
        return True

    def _cl_drag_release(self, source, ev):
        was_on = bool(self._dnd_state and self._dnd_state['on_bar'])
        self._dnd_finish(cancel=not was_on)
        return True

    def _cl_drag_key(self, source, ev):
        keyname = Gdk.keyval_name(ev.keyval)
        if keyname == 'Escape' and self._dnd_state:
            self._dnd_finish(cancel=True)
            return True
        return False

    def _dnd_finish(self, cancel=False):
        st = self._dnd_state
        if not st:
            return
        commit = st['on_bar'] and not cancel
        if st['on_bar']:
            self.bridge.send({'type': 'dragEnd', 'commit': commit})
        try:
            st['device'].ungrab(Gdk.CURRENT_TIME)
        except Exception:
            pass
        for widget, hid in st['handlers']:
            widget.disconnect(hid)
        self.ghost.hide()
        self._dnd_state = None

    def _cl_chip_activate(self, btn, wtype):
        """Keyboard alternative to dragging: Enter drops the widget mid-bar."""
        bar_w = self.cl_state['bar_w']
        self.bridge.send({'type': 'dragStart', 'widgetType': wtype})
        self.bridge.send({'type': 'dragMove', 'x': bar_w / 2, 'y': 0})
        self.bridge.send({'type': 'dragEnd', 'commit': True})

    # ── save / restart ──
    def _on_save(self, btn):
        try:
            write_config(self.paths.config_path, self.state)
            self.dirty = False
            self.set_status('Saved', 'ok')
            self.restart_btn.set_visible(True)
        except Exception as e:
            self.set_status(f'Save failed: {e}', 'err')

    def _on_restart(self, btn):
        try:
            r = subprocess.run(['systemctl', '--user', 'restart', 'react-drm.service'],
                               capture_output=True, timeout=30)
            if r.returncode == 0:
                self.set_status('react-drm restarted', 'ok')
                self.restart_btn.set_visible(False)
            else:
                self.set_status(f'Restart failed: {r.stderr.decode().strip()}', 'err')
        except Exception as e:
            self.set_status(f'Restart failed: {e}', 'err')


def _cairo_color(hexstr):
    s = (hexstr or '#000').lstrip('#')
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if len(s) == 8:
        s = s[2:]
    try:
        v = int(s, 16)
        return ((v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255, 1.0)
    except ValueError:
        return (0.11, 0.12, 0.15, 1.0)


def _rounded_rect(cr, x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -1.5707963, 0)
    cr.arc(x + w - r, y + h - r, r, 0, 1.5707963)
    cr.arc(x + r, y + h - r, r, 1.5707963, 3.14159265)
    cr.arc(x + r, y + r, r, 3.14159265, 4.71238898)
    cr.close_path()


def hf(v):
    return v


# ── niri blur layer-rule (compositor-side blur; optional) ────────────────────

LAYER_RULE_MARKER = '// react-drm config-gui layer rule (auto-installed)'


def ensure_niri_layer_rule():
    if not os.environ.get('NIRI_SOCKET'):
        return
    path = os.path.join(home(), '.config/niri/config.kdl')
    try:
        with open(path) as f:
            current = f.read()
    except OSError:
        return
    rule = (f'{LAYER_RULE_MARKER}\nlayer-rule {{\n'
            f'    match namespace="touchbar-config"\n'
            f'    background-effect {{ blur true; }}\n}}\n')
    if LAYER_RULE_MARKER in current:
        return
    try:
        with open(path, 'a') as f:
            f.write('\n' + rule)
    except OSError:
        pass


# ── main ─────────────────────────────────────────────────────────────────────


def main():
    ensure_niri_layer_rule()
    gui = ConfigGUI(default_repo_dir())
    Gtk.main()


if __name__ == '__main__':
    main()
