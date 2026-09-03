# Complete Linux evdev keyboard key registry (input-event-codes.h, codes 1-248).
# Used by the Fn-key editor to expose EVERY injectable key in a grouped dropdown.
# The native injector now registers all codes (1..KEY_MAX), so every key listed
# here actually reaches the system — not just the old hardcoded subset.

# Full map: name -> evdev code. Every entry is unique per code (later aliases
# for PRINT win, but SYSRQ is kept too since it's the canonical Print Screen).
KEY = {
    # Esc
    'ESC': 1,
    # Digits 0-9
    'KEY_1': 2, 'KEY_2': 3, 'KEY_3': 4, 'KEY_4': 5, 'KEY_5': 6,
    'KEY_6': 7, 'KEY_7': 8, 'KEY_8': 9, 'KEY_9': 10, 'KEY_0': 11,
    # Row punctuation
    'MINUS': 12, 'EQUAL': 13, 'BACKSPACE': 14, 'TAB': 15,
    'LEFTBRACE': 26, 'RIGHTBRACE': 27, 'BACKSLASH': 43, 'GRAVE': 41,
    'SEMICOLON': 39, 'APOSTROPHE': 40, 'COMMA': 51, 'DOT': 52, 'SLASH': 53,
    'SPACE': 57,
    # Letters
    'A': 30, 'B': 48, 'C': 46, 'D': 32, 'E': 18, 'F': 33, 'G': 34, 'H': 35,
    'I': 23, 'J': 36, 'K': 37, 'L': 38, 'M': 50, 'N': 49, 'O': 24, 'P': 25,
    'Q': 16, 'R': 19, 'S': 31, 'T': 20, 'U': 22, 'V': 47, 'W': 17, 'X': 45,
    'Y': 21, 'Z': 44,
    # Enter / control block
    'ENTER': 28,
    # Modifiers
    'LEFTCTRL': 29, 'RIGHTCTRL': 97, 'LEFTALT': 56, 'RIGHTALT': 100,
    'LEFTSHIFT': 42, 'RIGHTSHIFT': 54, 'LEFTMETA': 125, 'RIGHTMETA': 126,
    'COMPOSE': 127, 'CAPSLOCK': 58, 'SCROLLLOCK': 70, 'NUMLOCK': 69,
    # Function keys
    'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
    'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68, 'F11': 87, 'F12': 88,
    'F13': 183, 'F14': 184, 'F15': 185, 'F16': 186, 'F17': 187,
    'F18': 188, 'F19': 189, 'F20': 190, 'F21': 191, 'F22': 192,
    'F23': 193, 'F24': 194,
    # Numpad
    'KP7': 71, 'KP8': 72, 'KP9': 73, 'KPMINUS': 74, 'KP4': 75, 'KP5': 76,
    'KP6': 77, 'KPPLUS': 78, 'KP1': 79, 'KP2': 80, 'KP3': 81, 'KP0': 82,
    'KPDOT': 83, 'KPENTER': 96, 'KPSLASH': 98, 'KPASTERISK': 55,
    'KPEQUAL': 117, 'KPCOMMA': 121,
    # Print / nav / editing
    'SYSRQ': 99, 'PRINT': 99,  # Print Screen (99)
    'HOME': 102, 'UP': 103, 'PAGEUP': 104, 'LEFT': 105, 'RIGHT': 106,
    'END': 107, 'DOWN': 108, 'PAGEDOWN': 109, 'INSERT': 110, 'DELETE': 111,
    'PAUSE': 119,
    # Media / playback
    'MUTE': 113, 'VOLUMEDOWN': 114, 'VOLUMEUP': 115, 'POWER': 116,
    'PLAYPAUSE': 164, 'NEXTSONG': 163, 'PREVIOUSSONG': 165, 'STOPCD': 166,
    'PLAY': 207, 'STOP': 128, 'RECORD': 167, 'REWIND': 168, 'FASTFORWARD': 208,
    'PLAYCD': 200, 'PAUSECD': 201, 'CLOSECD': 160, 'EJECTCD': 161,
    'EJECTCLOSECD': 162, 'BASSBOOST': 209,
    # System / display / keyboard light
    'BRIGHTNESSDOWN': 224, 'BRIGHTNESSUP': 225, 'SWITCHVIDEOMODE': 227,
    'MEDIA': 226, 'KBDILLUMTOGGLE': 228, 'KBDILLUMDOWN': 229,
    'KBDILLUMUP': 230, 'MICMUTE': 248, 'SLEEP': 142, 'WAKEUP': 143,
    'SUSPEND': 205,
    # Apps / internet
    'WWW': 150, 'HOMEPAGE': 172, 'MAIL': 155, 'BOOKMARKS': 156, 'CALC': 140,
    'COMPUTER': 157, 'BACK': 158, 'FORWARD': 159, 'REFRESH': 173,
    'SEARCH': 217, 'PHONE': 169, 'CHAT': 216, 'CONNECT': 218,
    'ALL_APPLICATIONS': 204, 'CYCLEWINDOWS': 154, 'FILE': 144, 'DOCUMENTS': 235,
    # Editing
    'CUT': 137, 'COPY': 133, 'PASTE': 135, 'UNDO': 131, 'REDO': 182,
    'FIND': 136, 'OPEN': 134, 'NEW': 181, 'CLOSE': 206, 'HELP': 138,
    'MENU': 139, 'AGAIN': 129, 'PROPS': 130, 'FRONT': 132,
    # Misc / media keypad
    'CAMERA': 212, 'SOUND': 213, 'BATTERY': 236, 'BLUETOOTH': 237,
    'WLAN': 238, 'RFKILL': 247, 'WWAN': 246, 'EMAIL': 215, 'SEND': 231,
    'REPLY': 232, 'SAVE': 234, 'SCROLLUP': 177, 'SCROLLDOWN': 178,
    'LINE': 101, 'YEN': 124, 'MACRO': 112, 'MOVE': 175, 'EDIT': 176,
    'EXIT': 174, 'ROTATE_DISPLAY': 153,
    # Back-compat aliases used by older configs
    'KEY_B': 48, 'KEY_F': 33, 'KEY_H': 35, 'KEY_P': 25, 'KEY_R': 19,
    'KEY_S': 31, 'KEY_T': 20, 'KEY_W': 17, 'KEY_Z': 44, 'KEY_COMMA': 51,
}

# Reverse map: code -> canonical name (PRINT preferred as the friendly one).
_RAW = {}
for _n, _c in KEY.items():
    if _c not in _RAW or _n == 'PRINT':
        _RAW[_c] = _n
CODE_TO_KEY_NAME = _RAW


def key_name(code):
    return CODE_TO_KEY_NAME.get(code, str(code))


def key_display(code):
    name = CODE_TO_KEY_NAME.get(code)
    if name is None:
        return f'code {code}'
    return _fmt(name)


def _fmt(name):
    n = name.replace('KEY_', '')
    display = {
        'ESC': 'Esc', 'BACKSPACE': 'Backspace', 'ENTER': 'Enter', 'TAB': 'Tab',
        'SPACE': 'Space', 'CAPSLOCK': 'Caps Lock', 'SCROLLLOCK': 'Scroll Lock',
        'NUMLOCK': 'Num Lock', 'GRAVE': 'Grave ~ `', 'MINUS': 'Minus -',
        'EQUAL': 'Equal =', 'SEMICOLON': 'Semicolon ;', 'APOSTROPHE': 'Apostrophe \'',
        'COMMA': 'Comma ,', 'DOT': 'Dot .', 'SLASH': 'Slash /',
        'LEFTBRACE': '[', 'RIGHTBRACE': ']', 'BACKSLASH': 'Backslash \\',
        'COMPOSE': 'Compose', 'SYSRQ': 'Print Screen', 'PRINT': 'Print Screen',
        'LEFTMETA': 'Left Super/Meta', 'RIGHTMETA': 'Right Super/Meta',
        'HOME': 'Home', 'END': 'End', 'PAGEUP': 'Page Up', 'PAGEDOWN': 'Page Down',
        'INSERT': 'Insert', 'DELETE': 'Delete', 'PAUSE': 'Pause/Break',
        'PLAYPAUSE': 'Play / Pause', 'NEXTSONG': 'Next Track',
        'PREVIOUSSONG': 'Previous Track', 'VOLUMEUP': 'Volume Up',
        'VOLUMEDOWN': 'Volume Down', 'MUTE': 'Mute', 'POWER': 'Power',
        'BRIGHTNESSDOWN': 'Brightness Down', 'BRIGHTNESSUP': 'Brightness Up',
        'SWITCHVIDEOMODE': 'Display Mode', 'KBDILLUMTOGGLE': 'Kbd Light Toggle',
        'KBDILLUMDOWN': 'Kbd Light Down', 'KBDILLUMUP': 'Kbd Light Up',
        'MICMUTE': 'Mic Mute', 'SLEEP': 'Sleep', 'WAKEUP': 'Wake Up',
        'SUSPEND': 'Suspend', 'WWW': 'Browser', 'HOMEPAGE': 'Homepage',
        'MAIL': 'Mail', 'BOOKMARKS': 'Bookmarks', 'CALC': 'Calculator',
        'COMPUTER': 'My Computer', 'BACK': 'Back', 'FORWARD': 'Forward',
        'REFRESH': 'Refresh', 'SEARCH': 'Search', 'PHONE': 'Phone',
        'CHAT': 'Chat', 'CONNECT': 'Connect', 'ALL_APPLICATIONS': 'Show All Apps',
        'CYCLEWINDOWS': 'Switch Window', 'FILE': 'File', 'DOCUMENTS': 'Documents',
        'CUT': 'Cut', 'COPY': 'Copy', 'PASTE': 'Paste', 'UNDO': 'Undo',
        'REDO': 'Redo', 'FIND': 'Find', 'OPEN': 'Open', 'NEW': 'New',
        'CLOSE': 'Close', 'HELP': 'Help', 'MENU': 'Menu', 'AGAIN': 'Again',
        'PROPS': 'Properties', 'FRONT': 'Front', 'CAMERA': 'Camera',
        'SOUND': 'Sound', 'BATTERY': 'Battery', 'BLUETOOTH': 'Bluetooth',
        'WLAN': 'WiFi', 'RFKILL': 'Airplane/RFKill', 'WWAN': 'WWAN',
        'EMAIL': 'Email', 'SEND': 'Send', 'REPLY': 'Reply', 'SAVE': 'Save',
        'SCROLLUP': 'Scroll Up', 'SCROLLDOWN': 'Scroll Down', 'YEN': 'Yen',
        'MACRO': 'Macro', 'MOVE': 'Move', 'EDIT': 'Edit', 'EXIT': 'Exit',
        'ROTATE_DISPLAY': 'Rotate Display', 'STOPCD': 'Stop',
        'PLAYCD': 'Play CD', 'PAUSECD': 'Pause CD', 'CLOSECD': 'Close CD',
        'EJECTCD': 'Eject', 'EJECTCLOSECD': 'Eject/Close CD',
        'FASTFORWARD': 'Fast Forward', 'REWIND': 'Rewind', 'RECORD': 'Record',
        'PLAY': 'Play', 'STOP': 'Stop', 'BASSBOOST': 'Bass Boost',
        'KPENTER': 'Numpad Enter', 'KPSLASH': 'Numpad /',
        'KPASTERISK': 'Numpad *', 'KPMINUS': 'Numpad -', 'KPPLUS': 'Numpad +',
        'KPDOT': 'Numpad .', 'KPCOMMA': 'Numpad ,', 'KPEQUAL': 'Numpad =',
        'LINE': 'Linefeed', 'MEDIA': 'Media', 'CANCEL': 'Cancel',
    }
    return display.get(name, n.replace('_', ' ') if False else n)


# Ordered groups for the dropdown: (group title, [(display, KEY name)])
KEY_GROUPS = [
    ('Function Keys', [('F1', 'F1'), ('F2', 'F2'), ('F3', 'F3'), ('F4', 'F4'),
                       ('F5', 'F5'), ('F6', 'F6'), ('F7', 'F7'), ('F8', 'F8'),
                       ('F9', 'F9'), ('F10', 'F10'), ('F11', 'F11'),
                       ('F12', 'F12'), ('F13', 'F13'), ('F14', 'F14'),
                       ('F15', 'F15'), ('F16', 'F16'), ('F17', 'F17'),
                       ('F18', 'F18'), ('F19', 'F19'), ('F20', 'F20'),
                       ('F21', 'F21'), ('F22', 'F22'), ('F23', 'F23'),
                       ('F24', 'F24')]),
    ('Media / Playback', [('Play / Pause', 'PLAYPAUSE'), ('Play', 'PLAY'),
                          ('Stop', 'STOP'), ('Next Track', 'NEXTSONG'),
                          ('Previous Track', 'PREVIOUSSONG'), ('Rewind', 'REWIND'),
                          ('Fast Forward', 'FASTFORWARD'), ('Record', 'RECORD'),
                          ('Play CD', 'PLAYCD'), ('Pause CD', 'PAUSECD'),
                          ('Volume Up', 'VOLUMEUP'), ('Volume Down', 'VOLUMEDOWN'),
                          ('Mute', 'MUTE'), ('Eject', 'EJECTCD'),
                          ('Stop', 'STOPCD')]),
    ('System / Display', [('Brightness Up', 'BRIGHTNESSUP'),
                          ('Brightness Down', 'BRIGHTNESSDOWN'),
                          ('Display Mode', 'SWITCHVIDEOMODE'), ('Media', 'MEDIA'),
                          ('Kbd Light Toggle', 'KBDILLUMTOGGLE'),
                          ('Kbd Light Up', 'KBDILLUMUP'),
                          ('Kbd Light Down', 'KBDILLUMDOWN'),
                          ('Mic Mute', 'MICMUTE'), ('Search', 'SEARCH'),
                          ('Menu', 'MENU'), ('Power', 'POWER'), ('Sleep', 'SLEEP'),
                          ('Wake Up', 'WAKEUP'), ('Suspend', 'SUSPEND')]),
    ('Navigation', [('Home', 'HOME'), ('End', 'END'), ('Page Up', 'PAGEUP'),
                    ('Page Down', 'PAGEDOWN'), ('Left', 'LEFT'), ('Right', 'RIGHT'),
                    ('Up', 'UP'), ('Down', 'DOWN'), ('Insert', 'INSERT'),
                    ('Delete', 'DELETE'), ('Backspace', 'BACKSPACE'),
                    ('Tab', 'TAB'), ('Enter', 'ENTER'), ('Esc', 'ESC'),
                    ('Print Screen', 'PRINT'), ('Caps Lock', 'CAPSLOCK'),
                    ('Scroll Lock', 'SCROLLLOCK'), ('Pause/Break', 'PAUSE')]),
    ('Modifiers', [('Left Ctrl', 'LEFTCTRL'), ('Right Ctrl', 'RIGHTCTRL'),
                   ('Left Alt', 'LEFTALT'), ('Right Alt', 'RIGHTALT'),
                   ('Left Shift', 'LEFTSHIFT'), ('Right Shift', 'RIGHTSHIFT'),
                   ('Left Super/Meta', 'LEFTMETA'), ('Right Super/Meta', 'RIGHTMETA'),
                   ('Compose', 'COMPOSE')]),
    ('Letters', [('A', 'A'), ('B', 'B'), ('C', 'C'), ('D', 'D'), ('E', 'E'),
                 ('F', 'F'), ('G', 'G'), ('H', 'H'), ('I', 'I'), ('J', 'J'),
                 ('K', 'K'), ('L', 'L'), ('M', 'M'), ('N', 'N'), ('O', 'O'),
                 ('P', 'P'), ('Q', 'Q'), ('R', 'R'), ('S', 'S'), ('T', 'T'),
                 ('U', 'U'), ('V', 'V'), ('W', 'W'), ('X', 'X'), ('Y', 'Y'),
                 ('Z', 'Z')]),
    ('Digits', [('1', 'KEY_1'), ('2', 'KEY_2'), ('3', 'KEY_3'), ('4', 'KEY_4'),
                ('5', 'KEY_5'), ('6', 'KEY_6'), ('7', 'KEY_7'), ('8', 'KEY_8'),
                ('9', 'KEY_9'), ('0', 'KEY_0')]),
    ('Punctuation', [('Space', 'SPACE'), ('Minus -', 'MINUS'), ('Equal =', 'EQUAL'),
                     ('Comma ,', 'COMMA'), ('Dot .', 'DOT'), ('Slash /', 'SLASH'),
                     ('Semicolon ;', 'SEMICOLON'), ('Apostrophe \'', 'APOSTROPHE'),
                     ('Grave ~ `', 'GRAVE'), ('[', 'LEFTBRACE'), (']', 'RIGHTBRACE'),
                     ('Backslash \\', 'BACKSLASH'), ('Backquote', 'GRAVE')]),
    ('Numpad', [('Numpad 0', 'KP0'), ('Numpad 1', 'KP1'), ('Numpad 2', 'KP2'),
                ('Numpad 3', 'KP3'), ('Numpad 4', 'KP4'), ('Numpad 5', 'KP5'),
                ('Numpad 6', 'KP6'), ('Numpad 7', 'KP7'), ('Numpad 8', 'KP8'),
                ('Numpad 9', 'KP9'), ('Numpad Enter', 'KPENTER'),
                ('Numpad +', 'KPPLUS'), ('Numpad -', 'KPMINUS'),
                ('Numpad *', 'KPASTERISK'), ('Numpad /', 'KPSLASH'),
                ('Numpad .', 'KPDOT'), ('Numpad ,', 'KPCOMMA'),
                ('Numpad =', 'KPEQUAL'), ('Num Lock', 'NUMLOCK')]),
    ('Apps / Internet', [('Browser', 'WWW'), ('Homepage', 'HOMEPAGE'),
                         ('Mail', 'MAIL'), ('Email', 'EMAIL'), ('Bookmarks', 'BOOKMARKS'),
                         ('Calculator', 'CALC'), ('My Computer', 'COMPUTER'),
                         ('Back', 'BACK'), ('Forward', 'FORWARD'),
                         ('Refresh', 'REFRESH'), ('Search', 'SEARCH'),
                         ('Phone', 'PHONE'), ('Chat', 'CHAT'), ('Connect', 'CONNECT'),
                         ('Show All Apps', 'ALL_APPLICATIONS'),
                         ('Switch Window', 'CYCLEWINDOWS'), ('File', 'FILE'),
                         ('Documents', 'DOCUMENTS')]),
    ('Editing', [('Cut', 'CUT'), ('Copy', 'COPY'), ('Paste', 'PASTE'),
                 ('Undo', 'UNDO'), ('Redo', 'REDO'), ('Find', 'FIND'),
                 ('Open', 'OPEN'), ('New', 'NEW'), ('Close', 'CLOSE'),
                 ('Help', 'HELP'), ('Save', 'SAVE'), ('Send', 'SEND'),
                 ('Reply', 'REPLY')]),
    ('Misc / Devices', [('Camera', 'CAMERA'), ('Sound', 'SOUND'),
                        ('Battery', 'BATTERY'), ('Bluetooth', 'BLUETOOTH'),
                        ('WiFi (WLAN)', 'WLAN'), ('Airplane (RFKill)', 'RFKILL'),
                        ('WWAN', 'WWAN'), ('Yen', 'YEN'), ('Macro', 'MACRO'),
                        ('Rotate Display', 'ROTATE_DISPLAY'), ('Scroll Up', 'SCROLLUP'),
                        ('Scroll Down', 'SCROLLDOWN')]),
]
