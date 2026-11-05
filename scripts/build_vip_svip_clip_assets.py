#!/usr/bin/env python3
"""Split the 18316.mp4 showcase into transparent, looping VIP/SVIP ornaments.

The supplied 720x1280 clip has letterboxing and seven scenes containing two
or three independently animated ornaments. These coordinates are *specific*
to that source, and deliberately exclude the scene changes. This script does
not assign membership, prices, permissions, or any live user entitlements.

Usage: python3 scripts/build_vip_svip_clip_assets.py /path/to/18316.mp4
Requires ffmpeg, numpy and scipy. The outputs are checked into the Android APK.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage


DEST = Path(__file__).resolve().parents[1] / "android-staging/app/src/main/assets/sharika-premium"
SIZE = 320
FPS = 10


@dataclass(frozen=True)
class Scene:
    start: float
    seconds: float
    names: tuple[str, ...]
    kind: str
    group: str
    # The badges have solid decorated centers; frames have transparent holes.
    fill_holes: bool
    triplet: bool = False


SCENES = (
    Scene(1.3, 2.7, ("svip-royal-badge-04", "svip-royal-badge-05"), "medal_style", "svip", True),
    Scene(7.4, 2.6, ("svip-royal-badge-01", "svip-royal-badge-02", "svip-royal-badge-03"),
          "medal_style", "svip", True, True),
    Scene(15.9, 2.3, ("vip-royal-badge-04", "vip-royal-badge-05"), "medal_style", "vip", True),
    Scene(21.3, 2.7, ("vip-royal-badge-02", "vip-royal-badge-03"), "medal_style", "vip", True),
    Scene(28.0, 2.6, ("vip-royal-frame-02", "vip-royal-frame-03"), "frame_style", "vip", False),
    Scene(34.0, 2.2, ("svip-royal-frame-04", "svip-royal-frame-05"), "frame_style", "svip", False),
    Scene(38.3, 1.9, ("vip-royal-frame-04", "vip-royal-frame-05"), "frame_style", "vip", False),
)


def silhouette(frame: np.ndarray, fill_holes: bool) -> np.ndarray:
    """Segment gold/bright badge artwork from the dark navy recording backdrop.

    Background hues vary by row and include dark dots, so a single chroma key
    leaves dark blue rectangles. An adaptive foreground mask avoids those and
    retains the central helmet/animal detail on *filled* badge artwork.
    """
    rgb = frame.astype(np.float32)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    luminance = .299 * red + .587 * green + .114 * blue
    bright = np.clip((luminance - 54) / 31, 0, 1)
    warm = np.clip((red - blue + 11) / 48, 0, 1)
    # Navy dots are not foreground; blue gems remain if visibly luminous.
    candidate = np.maximum(bright, warm) > .43
    candidate = ndimage.binary_closing(candidate, iterations=2)
    labels, n = ndimage.label(candidate)
    if n:
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        candidate &= sizes[labels] >= max(24, int(candidate.sum() * .002))
    if fill_holes:
        candidate = ndimage.binary_fill_holes(candidate)
    alpha = ndimage.gaussian_filter(candidate.astype(np.float32), sigma=.85)
    return np.uint8(np.clip((alpha - .06) / .90, 0, 1) * 255)


def render(source: Path, scene: Scene, index: int, slug: str) -> Path:
    if scene.triplet:
        crop = (index * 240, 480, 240, 265)
    else:
        crop = (index * 360, 460, 360, 340)
    x, y, width, height = crop
    filters = (f"fps={FPS},crop={width}:{height}:{x}:{y},"
               f"scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease:flags=lanczos,"
               f"pad={SIZE}:{SIZE}:(ow-iw)/2:(oh-ih)/2,format=rgb24")
    decoder = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(scene.start),
        "-i", str(source), "-t", str(scene.seconds), "-vf", filters,
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"
    ], stdout=subprocess.PIPE)
    target = DEST / (slug + ".webp")
    encoder = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
        "-pix_fmt", "rgba", "-s", f"{SIZE}x{SIZE}", "-r", str(FPS),
        "-i", "pipe:0", "-an", "-c:v", "libwebp_anim", "-q:v", "78",
        "-loop", "0", "-y", str(target)
    ], stdin=subprocess.PIPE)
    count = 0
    try:
        while True:
            data = decoder.stdout.read(SIZE * SIZE * 3)
            if not data:
                break
            if len(data) != SIZE * SIZE * 3:
                raise ValueError(f"Partial video frame in {slug}")
            frame = np.frombuffer(data, dtype=np.uint8).reshape(SIZE, SIZE, 3)
            alpha = silhouette(frame, scene.fill_holes)
            rgba = np.concatenate((frame, alpha[:, :, None]), axis=2)
            encoder.stdin.write(rgba.tobytes())
            count += 1
    finally:
        decoder.stdout.close()
        encoder.stdin.close()
    if decoder.wait() != 0 or encoder.wait() != 0 or count < 10 or target.stat().st_size < 1000:
        raise RuntimeError(f"Video extraction failed for {slug}")
    return target


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_vip_svip_clip_assets.py /path/to/18316.mp4")
    source = Path(sys.argv[1]).resolve()
    if not source.is_file():
        raise SystemExit(f"Missing clip: {source}")
    DEST.mkdir(parents=True, exist_ok=True)
    additions = []
    for scene in SCENES:
        for index, slug in enumerate(scene.names):
            path = render(source, scene, index, slug)
            name = slug.replace("-", " ").upper().replace("ROYAL", "Royal").replace("BADGE", "Badge").replace("FRAME", "Frame")
            additions.append({"id": slug, "kind": scene.kind, "group": scene.group,
                              "name": name, "art": path.name})
            print(f"{path.name}: {path.stat().st_size:,} bytes")
    manifest = DEST / "manifest.json"
    original = json.loads(manifest.read_text(encoding="utf-8"))
    new_ids = {item["id"] for item in additions}
    manifest.write_text(json.dumps([item for item in original if item["id"] not in new_ids] + additions,
                                   indent=2) + "\n", encoding="utf-8")
    print(f"Registered {len(additions)} ornaments in {manifest}")


if __name__ == "__main__":
    main()
