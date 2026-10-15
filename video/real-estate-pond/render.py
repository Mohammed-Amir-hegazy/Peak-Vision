#!/usr/bin/env python3
"""Procedural cinemagraph render of source.jpg.

Locked-off camera with a slow ~7% centred push-in. Only the water, the
foreground grasses and the foliage move (sub-pixel to a few pixels of
displacement, masked so architecture never moves), plus a few distant birds.
No colour processing: every unmasked pixel is the source pixel, so lighting,
white balance and saturation match the still exactly.

Usage: python3 render.py [--seconds 10] [--out clip.mp4]
Needs numpy, Pillow and ffmpeg (libx264 + aac).
"""
import argparse
import os
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 24
ZOOM_END = 1.07  # 7% push-in over the whole clip


# ---------------------------------------------------------------- masks

def poly_mask(size, polys, feather):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon(p, fill=255)
    if feather:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m, np.float32) / 255.0


def build_masks(src):
    W, H = src.size
    rgb = np.asarray(src, np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # Pond surface (hand-traced), kept off the bridge deck and the gravel bank.
    water = poly_mask((W, H), [[
        (165, 945), (260, 918), (450, 906), (700, 894), (760, 892),
        (870, 882), (1250, 884), (1330, 892), (1300, 915), (1150, 950),
        (1000, 985), (900, 1005), (700, 1010), (400, 1005), (250, 990)]],
        feather=5)
    # Only where the pixels actually look like water (excludes leaves in
    # front of the pond and the gravel bank).
    wet = ((b > r + 8) & (g > r + 4)) | (np.minimum(np.minimum(r, g), b) > 185)
    wet = wet.astype(np.uint8) * 255
    wet = Image.fromarray(wet).filter(ImageFilter.MaxFilter(9)).filter(
        ImageFilter.GaussianBlur(4))
    water *= np.asarray(wet, np.float32) / 255.0

    # Rigid structures that must never move: pergola posts, bridge deck and
    # railings, central facade, and all the people.
    rigid = poly_mask((W, H), [
        [(85, 600), (122, 600), (122, 835), (85, 835)],      # pergola post
        [(175, 600), (210, 600), (210, 835), (175, 835)],    # pergola post
        [(315, 600), (345, 600), (345, 800), (315, 800)],    # pergola post
        [(0, 610), (395, 610), (395, 700), (0, 700)],        # pergola beams
        [(755, 740), (1510, 760), (1510, 880), (1250, 878), (1000, 870),
         (870, 874), (755, 892)],                             # bridge
        [(800, 280), (950, 280), (950, 760), (800, 760)],    # rigid facade
        [(555, 700), (740, 700), (740, 880), (555, 880)],    # family of four
        [(1070, 630), (1210, 630), (1210, 870), (1070, 870)],  # bridge couple
        [(590, 395), (680, 395), (680, 475), (590, 475)],    # balcony couple
        [(725, 455), (775, 455), (775, 515), (725, 515)],    # balcony man
    ], feather=3)
    water *= 1.0 - rigid

    # Foreground grasses / plumes, rooted at the bottom edge.
    grass = poly_mask((W, H), [
        [(0, 770), (80, 790), (130, 830), (230, 850), (250, 920),
         (200, 980), (260, 1066), (0, 1066)],
        [(1180, 1066), (1200, 960), (1300, 905), (1420, 895), (1480, 895),
         (1515, 800), (1600, 780), (1600, 1066)],
        [(0, 1000), (1600, 990), (1600, 1066), (0, 1066)],
    ], feather=8)
    grass *= 1.0 - rigid
    water *= 1.0 - grass
    # Tips sway more than roots: weight grows towards the top of each clump.
    grass_tip = np.clip((1066.0 - yy) / 260.0, 0.25, 1.0)

    # Foliage: strict "green" pixels, cleaned of thin facade shadow lines,
    # limited to regions with trees, shrubs, balcony and rooftop plants.
    green = ((g > r + 4) & (g > b + 10)).astype(np.uint8) * 255
    gm = Image.fromarray(green).filter(ImageFilter.MinFilter(5)).filter(
        ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3))
    green = np.asarray(gm, np.float32) / 255.0
    allowed = poly_mask((W, H), [
        [(0, 40), (560, 40), (560, 760), (0, 760)],          # left block + trees
        [(540, 150), (800, 150), (800, 720), (540, 720)],    # balcony plants
        [(930, 360), (1600, 360), (1600, 880), (930, 880)],  # right trees/roofs
        [(370, 600), (930, 600), (930, 880), (370, 880)],    # trees behind family
    ], feather=4)
    foliage = green * allowed * (1.0 - rigid) * (1.0 - grass) * (1.0 - water)

    return water, grass * grass_tip, foliage, xx, yy


# ---------------------------------------------------------------- motion

def displacement(t, water, grass, foliage, xx, yy):
    dx = np.zeros_like(xx)
    dy = np.zeros_like(xx)

    # Water: reflections wobble horizontally (high vertical frequency, as on a
    # real pond seen at a grazing angle) plus soft concentric wavelets.
    wx = (1.6 * np.sin(0.11 * yy + 0.012 * xx - 1.9 * t)
          + 0.8 * np.sin(0.23 * yy - 0.021 * xx + 2.7 * t + 1.3)
          + 0.4 * np.sin(0.41 * yy + 0.05 * xx - 3.4 * t))
    cx, cy = 760.0, 965.0
    rr = np.sqrt((xx - cx) ** 2 + (3.2 * (yy - cy)) ** 2)
    ring = np.sin(0.075 * rr - 2.2 * t) * np.exp(-rr / 650.0)
    dx += water * wx
    dy += water * (0.45 * np.sin(0.17 * yy + 0.03 * xx - 2.3 * t) + 0.9 * ring)

    # Grasses: slow, uneven sway with a breeze gust envelope; neighbouring
    # blades are out of phase so they move independently.
    gust = 0.75 + 0.25 * np.sin(0.45 * t) + 0.12 * np.sin(1.3 * t + 0.7)
    gx = (np.sin(1.25 * t + 0.021 * xx + 0.009 * yy)
          + 0.45 * np.sin(2.3 * t + 0.093 * xx + 0.05 * yy + 2.0)
          + 0.25 * np.sin(3.7 * t + 0.31 * xx))
    dx += grass * 2.6 * gust * gx
    dy += grass * 0.35 * np.sin(1.9 * t + 0.05 * xx)

    # Foliage: light leaf flutter on top of a slow canopy drift.
    fx = (0.55 * np.sin(0.012 * xx + 0.008 * yy + 0.9 * t)
          + 0.35 * np.sin(0.21 * xx + 0.17 * yy + 3.1 * t)
          + 0.20 * np.sin(0.37 * xx - 0.29 * yy + 4.3 * t + 1.1))
    fy = 0.25 * np.sin(0.19 * xx + 0.23 * yy + 2.6 * t + 0.4)
    dx += foliage * fx
    dy += foliage * fy
    return dx, dy


def remap(src, dx, dy, xx, yy):
    """Bilinear sample src at (x+dx, y+dy); identity where displacement is 0."""
    H, W, _ = src.shape
    sx = np.clip(xx + dx, 0, W - 1.001)
    sy = np.clip(yy + dy, 0, H - 1.001)
    x0 = sx.astype(np.int32)
    y0 = sy.astype(np.int32)
    fx = (sx - x0)[..., None]
    fy = (sy - y0)[..., None]
    a = src[y0, x0]
    b = src[y0, x0 + 1]
    c = src[y0 + 1, x0]
    d = src[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


# ---------------------------------------------------------------- birds

BIRDS = [  # start x, y, speed px/s, flap Hz, size px, phase
    (760, 120, 34, 4.2, 6.0, 0.0),
    (705, 150, 30, 3.8, 5.0, 1.7),
    (1000, 70, 26, 4.6, 4.5, 0.9),
]


def draw_birds(img, t):
    ss = 4
    for x0, y0, v, hz, size, ph in BIRDS:
        x = x0 + v * t
        y = y0 + 6 * np.sin(0.6 * t + ph) - 0.8 * t
        if not (650 < x < 1330):  # keep well clear of the rooftops
            continue
        flap = np.sin(2 * np.pi * hz * t + ph)
        pad = int(size * 2)
        patch = Image.new("L", (pad * 2 * ss, pad * 2 * ss), 0)
        d = ImageDraw.Draw(patch)
        c = pad * ss
        s = size * ss
        wing_y = -flap * 0.55 * s
        w = max(1, int(0.9 * ss))
        d.line([(c - s, c + wing_y), (c - 0.3 * s, c - 0.1 * s), (c, c)],
               fill=255, width=w)
        d.line([(c + s, c + wing_y), (c + 0.3 * s, c - 0.1 * s), (c, c)],
               fill=255, width=w)
        alpha = patch.resize((pad * 2, pad * 2), Image.LANCZOS)
        ink = Image.new("RGB", alpha.size, (88, 104, 118))
        a = alpha.point(lambda p: int(p * 0.55))
        img.paste(ink, (int(round(x)) - pad, int(round(y)) - pad), a)


# ---------------------------------------------------------------- audio

def make_audio(path, seconds, sr=48000, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr

    # Water: brown-ish noise, gently lapping.
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sr)
    spec *= 1.0 / np.maximum(f, 40.0) ** 0.9
    spec[f > 2500] *= np.exp(-(f[f > 2500] - 2500) / 800.0)
    water = np.fft.irfft(spec, n)
    water /= np.abs(water).max()
    lap = 0.7 + 0.3 * np.sin(2 * np.pi * 0.23 * t) * np.sin(2 * np.pi * 0.07 * t + 1)
    water *= lap * 0.10

    left = water.copy()
    right = np.roll(water, 900)

    # Birdsong: sparse phrases of short chirps, distant and soft.
    tt = 0.4
    while tt < seconds - 0.6:
        pan = rng.uniform(0.2, 0.8)
        base = rng.uniform(2800, 4600)
        for _ in range(rng.integers(2, 6)):
            dur = rng.uniform(0.04, 0.12)
            m = int(dur * sr)
            s = int(tt * sr)
            if s + m >= n:
                break
            k = np.arange(m) / sr
            sweep = base * (1 + rng.uniform(-0.25, 0.35) * k / dur)
            phase = 2 * np.pi * np.cumsum(sweep) / sr
            env = np.sin(np.pi * k / dur) ** 2
            chirp = env * (np.sin(phase) + 0.15 * np.sin(2 * phase))
            chirp *= rng.uniform(0.05, 0.11)
            left[s:s + m] += chirp * (1 - pan)
            right[s:s + m] += chirp * pan
            # faint early reflection for distance
            r0 = s + int(0.031 * sr)
            if r0 + m < n:
                left[r0:r0 + m] += 0.25 * chirp * pan
                right[r0:r0 + m] += 0.25 * chirp * (1 - pan)
            tt += dur + rng.uniform(0.03, 0.12)
        tt += rng.uniform(0.6, 1.8)

    fade = np.minimum(1, np.minimum(t / 0.5, (seconds - t) / 0.5))
    st = np.stack([left, right], 1) * fade[:, None]
    st = np.clip(st / max(1e-9, np.abs(st).max()) * 0.5, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((st * 32767).astype("<i2").tobytes())


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--src", default=os.path.join(HERE, "source.jpg"))
    ap.add_argument("--out", default=os.path.join(HERE, "pond-push-in.mp4"))
    ap.add_argument("--still", type=float, default=None,
                    help="write a single PNG frame at this time and exit")
    args = ap.parse_args()

    src_img = Image.open(args.src).convert("RGB")
    W, H = src_img.size
    src = np.asarray(src_img, np.float32)
    water, grass, foliage, xx, yy = build_masks(src_img)
    moving = (water + grass + foliage) > 1e-3

    frames = int(round(args.seconds * FPS))

    def render(i):
        t = i / FPS
        dx, dy = displacement(t, water, grass, foliage, xx, yy)
        warped = remap(src, dx, dy, xx, yy)
        out = np.where(moving[..., None], warped, src)
        img = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
        draw_birds(img, t)
        # Push-in: smooth, continuous, centred (mostly linear, soft ends).
        u = i / max(1, frames - 1)
        e = 0.8 * u + 0.2 * (u * u * (3 - 2 * u))
        z = 1.0 + (ZOOM_END - 1.0) * e
        cw, ch = W / z, H / z
        box = ((W - cw) / 2, (H - ch) / 2, (W + cw) / 2, (H + ch) / 2)
        return img.resize((W, H), Image.LANCZOS, box=box)

    if args.still is not None:
        render(int(args.still * FPS)).save(args.out)
        return

    wav = args.out + ".wav"
    make_audio(wav, frames / FPS)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-", "-i", wav,
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-color_range", "tv",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart", args.out,
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(frames):
        p.stdin.write(render(i).tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit("ffmpeg failed")
    os.remove(wav)


if __name__ == "__main__":
    main()
