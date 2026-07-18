"""Best-effort foreground-window capture via ctypes (no new dependency:
pywin32 is not required for two user32/kernel32 calls). Used to tag dictation
transcripts with what app the user was dictating into when sent to Jarvis's
`/api/system/observe` as an auxiliary side-channel (see
app/api/system/observe/route.ts). Any failure here (no window focused,
permissions, non-Windows) must never break dictation -- callers get ("", "")
back and carry on.
"""

import ctypes
import ctypes.wintypes as wintypes

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def get_foreground_window_info() -> tuple:
    """Returns (window_title, process_name), best-effort. Empty strings on
    any failure (including on non-Windows platforms)."""
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return "", ""

        title = ""
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value

        process_name = ""
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value:
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
            if handle:
                try:
                    size = wintypes.DWORD(260)
                    name_buf = ctypes.create_unicode_buffer(260)
                    ok = kernel32.QueryFullProcessImageNameW(
                        handle, 0, name_buf, ctypes.byref(size)
                    )
                    if ok:
                        process_name = name_buf.value.rsplit("\\", 1)[-1]
                finally:
                    kernel32.CloseHandle(handle)

        return title, process_name
    except (AttributeError, OSError):
        # AttributeError: ctypes.windll doesn't exist off-Windows.
        # OSError: any win32 call failing.
        return "", ""
