# -*- coding: utf-8 -*-
"""
塗裝貼圖的原圖 → 遊戲用圖。

    python tools/livery/export.py            # 全部
    python tools/livery/export.py p51d b17g  # 指定機種

原圖在 `textures-src/<id>.png`（2048×1536，版面的原始尺寸，畫圖腳本輸出在這裡；
要手修也修這一份），遊戲讀的是 `public/textures/<id>.png`。兩份都進版控。

【只能等比縮】UV 是照 2048×1536 的版面算、再除成 0…1 的（`livery.ts`），貼圖
長寬比一變，整張塗裝就對不準，而且不會報錯。
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'textures-src')
OUT = os.path.join(ROOT, 'public', 'textures')

# 遊戲用圖的寬（px），高照 4:3。戰鬥機縮到 1536：每公尺 57–75 px，追尾視角的
# 自機在 1280 寬的畫面上約每公尺 40 螢幕像素。轟炸機攤到每公尺只有 32–44 px，
# 再縮近看就粗了，維持原尺寸
EXPORT_WIDTH = {
    'p51d': 1536, 'f6f5': 1536, 'f4f4': 1536, 'bf109k4': 1536, 'ki84': 1536, 'a6m5': 1536,
    'g4m': 2048, 'he111': 2048, 'b17g': 2048,
}


def export(id):
    src = os.path.join(SRC, f'{id}.png')
    out = os.path.join(OUT, f'{id}.png')
    im = Image.open(src)
    w = EXPORT_WIDTH[id]
    h = w * im.height // im.width
    if w * im.height != h * im.width:
        raise ValueError(f'{id}：{w} 寬縮不出整數的高，長寬比會跑掉')
    if (w, h) != im.size:
        im = im.resize((w, h), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    im.save(out, optimize=True)
    print(f'{out}  {w}×{h}  {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    for id in (sys.argv[1:] or EXPORT_WIDTH):
        export(id)
