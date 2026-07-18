"""Minimal Windows system tray icon: shows the dictation companion is
running, with a right-click Quit item. No visual design effort here by
design (Phase 7 Chunk 2 scope is functional completeness, not polish) -- a
solid-color dot on a dark square, same spirit as pystray's own examples.

pystray runs its icon loop on its own thread; `start_tray` returns
immediately. Quit calls the supplied callback once (to stop the hotkey
listener / worker cleanly) and then stops the icon.
"""

import threading

import pystray
from PIL import Image, ImageDraw


def _make_icon_image() -> Image.Image:
    size = 64
    image = Image.new("RGB", (size, size), "#0b0f14")
    draw = ImageDraw.Draw(image)
    draw.ellipse((10, 10, size - 10, size - 10), fill="#00e5ff")
    return image


def start_tray(on_quit) -> pystray.Icon:
    """Starts the tray icon on a daemon thread and returns the Icon object.

    on_quit: called exactly once, with no arguments, when Quit is chosen --
    the caller is responsible for stopping the hotkey listener / unblocking
    the main thread so the process can exit.
    """

    def _quit(icon, _item):
        icon.stop()
        on_quit()

    menu = pystray.Menu(pystray.MenuItem("Quit", _quit))
    icon = pystray.Icon("dictate", _make_icon_image(), "Dictate (Jarvis companion)", menu)
    thread = threading.Thread(target=icon.run, daemon=True)
    thread.start()
    return icon
