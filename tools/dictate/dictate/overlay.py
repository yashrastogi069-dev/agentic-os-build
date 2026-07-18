"""Futuristic floating wave overlay (tkinter, no extra deps).

A frameless rounded "pill" hovering bottom-center: neon cyan→violet gradient
waveform with rounded bars, pulsing REC dot while recording, and a sweeping
light animation while transcribing. Corners are truly transparent via
Windows' -transparentcolor. Tkinter runs on the main thread; worker threads
only write _state/_level (plain attribute writes) and _poll() does all drawing.
"""
import math
import collections
import tkinter as tk

BAR_COUNT = 34
POLL_MS = 33          # ~30 fps
W, H = 340, 66
PAD = 6               # pill inset
TRANSPARENT = "#010203"   # magic color -> fully transparent pixels
PILL_BG = "#0b0f14"
PILL_EDGE = "#1e3a4a"


def _lerp(a, b, t):
    return a + (b - a) * t


def _grad(c1, c2, n):
    return [
        "#%02x%02x%02x" % tuple(int(_lerp(c1[k], c2[k], i / (n - 1))) for k in range(3))
        for i in range(n)
    ]


# cyan -> violet across the bars
COLORS = _grad((0, 229, 255), (124, 77, 255), BAR_COUNT)
COLORS_DIM = _grad((0, 90, 110), (55, 35, 120), BAR_COUNT)


def _round_rect(c, x1, y1, x2, y2, r, **kw):
    pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
           x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return c.create_polygon(pts, smooth=True, **kw)


class WaveOverlay:
    def __init__(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.96)
        self.root.configure(bg=TRANSPARENT)
        try:
            self.root.attributes("-transparentcolor", TRANSPARENT)  # Windows only
        except tk.TclError:
            pass
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        self.root.geometry(f"{W}x{H}+{(sw - W) // 2}+{sh - H - 84}")
        self.canvas = tk.Canvas(self.root, width=W, height=H, bg=TRANSPARENT, highlightthickness=0)
        self.canvas.pack()
        self.levels = collections.deque([0.0] * BAR_COUNT, maxlen=BAR_COUNT)
        self._level = 0.0        # written from the audio callback thread
        self._state = "idle"     # idle | recording | busy
        self._visible = False
        self._tick = 0
        self._poll()

    # --- called from worker/audio threads (attribute writes only) ---
    def set_level(self, rms: float):
        self._level = rms

    def set_state(self, state: str):
        self._state = state

    # --- main thread only ---
    def run(self):
        self.root.mainloop()

    def _poll(self):
        self._tick += 1
        if self._state == "recording":
            self._show()
            # scroll the waveform; keep a tiny idle ripple so it never looks dead
            ripple = 0.03 + 0.02 * math.sin(self._tick * 0.25)
            self.levels.append(max(ripple, min(1.0, self._level * 10)))
            self._draw_recording()
        elif self._state == "busy":
            self._show()
            self.levels.append(self.levels[-1] * 0.8)
            self._draw_busy()
        else:
            self._hide()
        self.root.after(POLL_MS, self._poll)

    def _pill(self):
        c = self.canvas
        c.delete("all")
        _round_rect(c, PAD, PAD, W - PAD, H - PAD, (H - 2 * PAD) / 2,
                    fill=PILL_BG, outline=PILL_EDGE, width=1)

    def _bars(self, colors, boost=None):
        c = self.canvas
        left, right = PAD + 26, W - PAD - 16
        gap = (right - left) / BAR_COUNT
        mid = H / 2
        max_half = H / 2 - PAD - 8
        for i, lvl in enumerate(self.levels):
            half = 2 + lvl * max_half
            if boost is not None:
                # sweeping light: bars near the sweep position glow brighter/taller
                d = abs(i - boost)
                if d < 4:
                    half += (4 - d) * 2.2
            x = left + gap * i + gap / 2
            c.create_line(x, mid - half, x, mid + half,
                          fill=colors[i], width=max(3, gap * 0.5), capstyle="round")

    def _draw_recording(self):
        self._pill()
        # pulsing REC dot
        r = 3.4 + 1.4 * math.sin(self._tick * 0.28)
        cx, cy = PAD + 14, H / 2
        self.canvas.create_oval(cx - r - 2.5, cy - r - 2.5, cx + r + 2.5, cy + r + 2.5,
                                fill="", outline="#ff1744", width=1)
        self.canvas.create_oval(cx - r, cy - r, cx + r, cy + r, fill="#ff5252", width=0)
        self._bars(COLORS)

    def _draw_busy(self):
        self._pill()
        sweep = (self._tick * 0.9) % (BAR_COUNT + 8) - 4
        self._bars(COLORS_DIM, boost=sweep)
        self.canvas.create_text(W / 2, H - PAD - 4, text="t r a n s c r i b i n g",
                                fill="#7fdcff", font=("Segoe UI", 7), anchor="s")

    def _show(self):
        if not self._visible:
            self.root.deiconify()
            self._visible = True

    def _hide(self):
        if self._visible:
            self.root.withdraw()
            self._visible = False
            self.levels.extend([0.0] * BAR_COUNT)
