"""
把 `render_silhouettes.py` 拍出來的側視圖裁成選單用的機種徽章。

    python tools/compose_silhouettes.py

讀 `.shots/sil/raw/<id>.png`，寫 `public/ui/sil/<id>.png`（256×96，白色＋alpha）。

【只有 alpha 有用】CSS 那邊是 `mask-image`，顏色由 `.sil` 自己決定 —— 同一份
檔案在簡報頁是 `currentColor`、在編組頁是米白。改成 `<img>` 就會失去這個。

【大小用開根號壓過】照實際長度畫的話 P-51 只有 B-17 的 44%，在 64 px 的框裡
剩下 28 px，看不出是什麼。開根號之後轟炸機仍然明顯比較大（B-17 是 P-51 的
1.5 倍），戰鬥機也還讀得出機鼻與尾翼。要改回實際比例就把 `SIZE_EXP` 設成 1。
"""
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(REPO, '.shots', 'sil', 'raw')
OUT = os.path.join(REPO, 'public', 'ui', 'sil')

# 機身長（m），與 render_silhouettes.py 印出來的一致
LENGTH = {
    'p51d': 9.87, 'f4f4': 8.56, 'f6f5': 10.12, 'b17g': 22.67, 'bf109k4': 8.89,
    'he111': 16.21, 'a6m5': 9.18, 'ki84': 9.91, 'g4m': 19.75,
}

CANVAS = (256, 96)
# 最長的那一台在畫布裡佔多寬、最高的那一台佔多高；留白是給陣營章露出來的
MAX_W = 240
MAX_H = 88
SIZE_EXP = 0.5


def trim(img):
    """裁到 alpha 的邊界。全透明就整張回傳，讓錯誤看得出來而不是靜靜變成空白。"""
    box = img.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    return img if box is None else img.crop(box)


def main():
    os.makedirs(OUT, exist_ok=True)
    longest = max(LENGTH.values())
    for ident, length in LENGTH.items():
        src = trim(Image.open(os.path.join(RAW, ident + '.png')).convert('RGBA'))
        w = round(MAX_W * (length / longest) ** SIZE_EXP)
        h = round(src.height * w / src.width)
        if h > MAX_H:
            w = round(w * MAX_H / h)
            h = MAX_H
        small = src.resize((w, h), Image.LANCZOS)
        # 白色＋原來的 alpha：mask 只讀 alpha，但留白色的話直接當圖看也不會是黑塊
        flat = Image.new('RGBA', small.size, (255, 255, 255, 0))
        flat.putalpha(small.getchannel('A'))
        canvas = Image.new('RGBA', CANVAS, (255, 255, 255, 0))
        canvas.paste(flat, ((CANVAS[0] - w) // 2, (CANVAS[1] - h) // 2))
        path = os.path.join(OUT, ident + '.png')
        canvas.save(path, optimize=True)
        print('%-8s %3d×%-3d  %d bytes' % (ident, w, h, os.path.getsize(path)))


main()
