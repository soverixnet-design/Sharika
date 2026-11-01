#!/usr/bin/env python3
"""Extract transparent looping ornaments from the supplied Sharika videos.

Usage: python scripts/build_premium_assets.py VIP5.mp4 SVIP_SHEET.mp4 ROLE_SHEET.mp4
Pass --repair to regenerate only missing or empty outputs.
Re-running this script regenerates only its explicitly named animation assets.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


DEST = Path(__file__).resolve().parents[1] / "android-staging/app/src/main/assets/sharika-premium"
TASKS = {}
REPAIR_ONLY = "--repair" in sys.argv


def convert(source: Path, slug: str, crop: tuple[int, int, int, int], *, white=False, offset=1):
    x, y, width, height = crop
    color = "0xf9f7fb:0.20:0.08" if white else "0x17151b:0.19:0.08"
    filters = (
        f"crop={width}:{height}:{x}:{y},fps=12,format=rgba,"
        f"colorkey={color},scale='min(280,iw)':-2:flags=lanczos,format=yuva420p"
    )
    target = DEST / f"{slug}.webp"
    if REPAIR_ONLY and target.exists() and target.stat().st_size >= 1000:
        return target.name
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(offset),
        "-t", "3.6", "-i", str(source), "-vf", filters,
        "-an", "-c:v", "libwebp_anim", "-q:v", "70", "-loop", "0",
        "-y", str(target)
    ], check=True)
    if target.stat().st_size < 1000:
        raise ValueError(f"Unexpected empty animation: {target}")
    return target.name


def add(items, source, slug, kind, group, crop, *, white=False, offset=1, name=None):
    TASKS[f"{slug}.webp"] = (source, slug, crop, white, offset)
    filename = convert(source, slug, crop, white=white, offset=offset)
    items.append({"id": slug, "kind": kind, "group": group,
                  "name": name or slug.replace("-", " ").title(), "art": filename})


def main():
    if REPAIR_ONLY:
        sys.argv.remove("--repair")
    if len(sys.argv) != 4:
        raise SystemExit("Usage: build_premium_assets.py VIP5.mp4 SVIP.mp4 ROLES.mp4")
    vip, svip, roles = map(Path, sys.argv[1:])
    for source in (vip, svip, roles):
        if not source.is_file():
            raise SystemExit(f"Missing source video: {source}")
    DEST.mkdir(parents=True, exist_ok=True)
    items = []
    # Trim the black recording bars before keying away the white background.
    add(items, vip, "vip5-animated", "frame_style", "vip", (8, 0, 704, 720),
        white=True, offset=2, name="VIP5 Royal Wings")

    # The SVIP source is a live animated sheet, not eight ready-made files.
    columns = [0, 178, 356, 535]
    frame_labels = [[1, 2, 3, 4], [5, 6, 8, 7]]
    for row, top in enumerate((0, 151)):
        for col, left in enumerate(columns):
            number = frame_labels[row][col]
            add(items, svip, f"svip-frame-{number:02d}", "frame_style", "svip",
                (left, top, 177, 151), name=f"SVIP {number} Animated Frame")

    medals = [(356, 610), (535, 610)]
    medals += [(x, 750) for x in columns]
    medals += [(0, 900), (178, 900)]
    for number, (left, top) in enumerate(medals, 1):
        add(items, svip, f"svip-medal-{number:02d}", "medal_style", "svip",
            (left, top, 177, 134 if number <= 2 else 148),
            name=f"SVIP Animated Medal {number}")

    tags = [(x, 349, 177, 75) for x in columns]
    tags += [(x, 497, 177, 75) for x in columns]
    tags += [(x, 645, 177, 75) for x in columns[:2]]
    tags += [(356, 932, 177, 88), (535, 932, 177, 88)]
    tags += [(x, 1090, 177, 82) for x in columns]
    tags += [(0, 1240, 177, 82)]
    for number, crop in enumerate(tags, 1):
        add(items, svip, f"svip-tag-{number:02d}", "name_tag_style", "svip",
            crop, name=f"SVIP Nameplate {number}")

    # Role-themed ornaments are strictly cosmetic. They grant zero privileges.
    # The final rows contain intentional blank cells in the reference sheet.
    for row in range(11):
        present = range(6) if row < 8 or row == 9 else ([0, 1, 2, 5] if row == 8 else range(4))
        for col in present:
            number = row * 6 + col + 1
            height = 106 if (row,col)==(8,5) else min(115,1344-row*122-3)
            add(items, roles, f"role-frame-{number:02d}", "frame_style", "role",
                (col * 119, row * 122 + 3, 119, height),
                name=f"Royal Role Frame {number:02d}")
    # This unlabelled gold-microphone animation is available for Noble styling.
    add(items, roles, "noble-gold-microphone", "frame_style", "noble",
        (595, 979, 119, 106), name="Noble Gold Microphone")
    (DEST / "manifest.json").write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
    # Some remote scratch filesystems briefly leave a truncated target after
    # the media encoder exits; verify and repair the completed batch.
    for _ in range(4):
        missing = [item["art"] for item in items if (DEST / item["art"]).stat().st_size < 1000]
        if not missing:
            break
        for filename in missing:
            source, slug, crop, white, offset = TASKS[filename]
            convert(source, slug, crop, white=white, offset=offset)
    missing = [item["art"] for item in items if (DEST / item["art"]).stat().st_size < 1000]
    if missing:
        raise SystemExit("Incomplete rendered animations: " + ", ".join(missing))
    print(f"Created {len(items)} independently animated ornaments in {DEST}")


if __name__ == "__main__":
    main()
