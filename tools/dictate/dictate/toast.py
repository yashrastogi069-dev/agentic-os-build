"""Windows toast notifications for the F8 "ask Jarvis anywhere" hotkey.

Reuses pystray's `Icon.notify(message, title)` -- pystray is already a
dependency here for the tray icon (see tray.py), and its notify() call
surfaces a real Windows notification/toast, so no new notification library
is needed.

Never raises: if the tray icon failed to start (see main.py's try/except
around start_tray) or notify() itself errors, we fall back to a console
print rather than crashing the hotkey worker thread -- same "never break the
main flow" pattern as jarvis_client.post_json and cleanup.maybe_clean.
"""


def show_toast(icon, title: str, message: str) -> None:
    if icon is None:
        print(f"[toast unavailable, no tray icon] {title}: {message}")
        return
    try:
        icon.notify(message, title)
    except Exception as e:
        print(f"[toast] failed to show notification ({e}): {title}: {message}")
