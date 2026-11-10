"""Render an original transparent Golden Dragon King gift with an original sound.

Requires Pillow and FFmpeg (libvpx-vp9, libopus, libx264, aac).
Run from this directory: python3 build.py
"""

from __future__ import annotations

import math
import random
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent
SIZE = (720, 1280)
FPS = 24
SECONDS = 4
FRAMES = FPS * SECONDS
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def envelope(t: float) -> float:
    return min(1, t / .28, max(0, (SECONDS - t) / .3)) ** 1.15


def smooth_out(t: float) -> float:
    x = min(1.0, max(0.0, t))
    return 1 - (1-x)**3


def draw_frame(master: Image.Image, index: int) -> Image.Image:
    t = index / FPS
    opacity = envelope(t)
    canvas = Image.new("RGBA", SIZE)
    glow = Image.new("RGBA", SIZE)
    glow_d = ImageDraw.Draw(glow, "RGBA")
    sparks = Image.new("RGBA", SIZE)
    spark_d = ImageDraw.Draw(sparks, "RGBA")
    rng = random.Random(1010)
    for i in range(56):
        start_x = rng.randint(20, 700)
        start_y = rng.randint(200, 1050)
        phase = rng.uniform(0, 2*math.pi)
        speed = rng.randint(16, 52)
        x = start_x + 15*math.sin(t*1.8 + phase)
        y = (start_y - t*speed - 140) % 1000 + 140
        a = int(opacity * (85 + 150 * max(0, math.sin(phase + t*7))**4))
        radius = 2 + 4 * max(0, math.sin(phase + t*7))
        glow_d.ellipse((x-radius*3, y-radius*3, x+radius*3, y+radius*3), fill=(255, 169, 35, min(a, 150)))
        spark_d.line((x-radius, y, x+radius, y), fill=(255, 236, 169, a), width=2)
        spark_d.line((x, y-radius, x, y+radius), fill=(255, 247, 214, a), width=2)
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(12)))
    # First-quarter pop, then a calm floating motion. No solid backdrop is drawn.
    pop = smooth_out(t / .85)
    scale = .52 + .48*pop + .016*math.sin(t*math.tau*.7)
    w = round(670*scale)
    h = round(master.height * w / master.width)
    sprite = master.resize((w, h), Image.Resampling.LANCZOS)
    angle = 1.1 * math.sin(t*1.8)
    sprite = sprite.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    sprite.putalpha(sprite.getchannel("A").point(lambda a: int(a*opacity)))
    y = 615 + round(14 * math.sin(2.1*t))
    canvas.alpha_composite(sprite, ((720-sprite.width)//2, (2*y-sprite.height)//2))
    canvas.alpha_composite(sparks)
    if t > .35:
        title_layer = Image.new("RGBA", SIZE)
        draw = ImageDraw.Draw(title_layer)
        font = ImageFont.truetype(FONT, 36)
        label = "GOLDEN DRAGON KING"
        box = draw.textbbox((0,0), label, font=font, stroke_width=2)
        x = (720-(box[2]-box[0])) // 2
        draw.rounded_rectangle((x-28,1090,x+box[2]+28,1168),radius=24,
                               fill=(85,41,9,76),outline=(255,190,45,185),width=2)
        draw.text((x,1104),label,font=font,fill=(255,220,143,255),stroke_width=2,
                  stroke_fill=(96,50,13,255))
        title_opacity = opacity * min(1,(t-.35)/.25)
        title_layer.putalpha(title_layer.getchannel("A").point(lambda a:int(a*title_opacity)))
        canvas.alpha_composite(title_layer)
    return canvas


def render_sound(path: Path) -> None:
    # Entirely synthesized audio: a deep whoosh, resonant royal bell and sparkle.
    rate = 44100
    rng = random.Random(1402)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        samples = bytearray()
        previous_noise = 0.0
        strikes = ((.55,196.0,.65),(1.18,392.0,.8),(1.8,587.33,.75),(2.47,783.99,.45))
        for n in range(rate*SECONDS):
            t = n/rate
            noise = rng.uniform(-1,1)
            previous_noise = previous_noise*.96 + noise*.04
            whoosh_env = max(0,1-abs(t-.82)/.72)**2
            whoosh = previous_noise*whoosh_env*.21
            bass_env = min(1,max(0,(t-.18)*3))*math.exp(-max(0,t-.65)*1.1)
            bass = math.sin(math.tau*(73+12*t)*t)*bass_env*.13
            bells = 0.0
            for start,freq,level in strikes:
                s=t-start
                if s>=0:
                    e=(1-math.exp(-s*65))*math.exp(-s*2.2)
                    bells+=level*e*(math.sin(math.tau*freq*s)+.25*math.sin(math.tau*freq*2.01*s))
            fade=min(1,t/.1,(SECONDS-t)/.22)
            value=max(-1,min(1,(whoosh+bass+bells*.17)*max(0,fade)))
            samples.extend(struct.pack('<h',round(32767*value)))
        out.writeframes(samples)


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",*args],check=True)


def main() -> None:
    master = Image.open(HERE/"master.png").convert("RGBA")
    alpha = master.getchannel("A")
    bounds = alpha.point(lambda a:255 if a>9 else 0).getbbox()
    if bounds:
        master = master.crop(bounds)
    frames_dir = HERE/"frames"
    frames_dir.mkdir(exist_ok=True)
    for n in range(FRAMES):
        frame = draw_frame(master,n)
        frame.save(frames_dir/f"frame-{n:03}.png")
        if n == 51:
            frame.save(HERE/"poster.png",optimize=True)
    render_sound(HERE/"original-dragon-sound.wav")
    ffmpeg('-framerate',str(FPS),'-i',str(frames_dir/'frame-%03d.png'),
           '-i',str(HERE/'original-dragon-sound.wav'),
           '-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','30',
           '-deadline','good','-cpu-used','4','-row-mt','1','-auto-alt-ref','0',
           '-c:a','libopus','-b:a','96k','-t',str(SECONDS),
           str(HERE/'golden-dragon-king-transparent.webm'))
    ffmpeg('-f','lavfi','-i',f'color=c=0x180d26:s=720x1280:r={FPS}:d={SECONDS}',
           '-framerate',str(FPS),'-i',str(frames_dir/'frame-%03d.png'),
           '-i',str(HERE/'original-dragon-sound.wav'),
           '-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]',
           '-map','[v]','-map','2:a','-c:v','libx264','-preset','veryfast',
           '-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',
           '-t',str(SECONDS),str(HERE/'golden-dragon-king-preview.mp4'))
    print('Generated transparent WebM + MP4 preview, both with original sound.')


if __name__ == '__main__':
    main()
