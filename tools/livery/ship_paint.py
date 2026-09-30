# -*- coding: utf-8 -*-
"""
畫船的塗裝貼圖的共用工具。

版面來自 `test/tools/ship-livery-faces.ts` 倒出的 JSON（它走遊戲裡算 UV 的同一支
`shipLivery.ts`），這裡只照著換算：

    左舷條  (a, b) = (z, y)   站在左舷看，艦首在左
    右舷條  (a, b) = (z, y)   站在右舷看，艦首在右
    甲板條  (a, b) = (z, x)   俯視，艦首在左、右舷在上

座標是艦體座標（m）：X 橫向（+X 右舷）、Y 上（水線為 0）、−Z 艦首。

【整張先塗單色區的顏色】條與條之間的空白、右下角的單色區、沒用到的地方全是它；
每一條的漆往外延伸半個空白，mipmap 縮小時讀不到隔壁那一條的顏色。
"""
import json, os, random
from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 先畫兩倍大再縮回來，邊緣才有抗鋸齒
SS = 2
SIDES = ('port', 'starboard')


class ShipLivery:
    def __init__(self, faces_json):
        with open(faces_json, encoding='utf-8') as f:
            meta = json.load(f)
        self.id = meta['id']
        self.W, self.H = meta['width'], meta['height']
        self.L = meta['layout']
        self.R = meta['rects']
        self.faces = meta['faces']
        self.s = self.L['scale']
        self.im = Image.new('RGB', (self.W * SS, self.H * SS), (128, 128, 128))
        self.d = ImageDraw.Draw(self.im)

    # ── 座標換算 ────────────────────────────────────────────────
    def px(self, strip, a, b):
        L, r, s = self.L, self.R[strip], self.s
        if strip == 'port':
            u, v = r['x'] + (a - L['zMin']) * s, r['y'] + (L['yMax'] - b) * s
        elif strip == 'starboard':
            u, v = r['x'] + (L['zMax'] - a) * s, r['y'] + (L['yMax'] - b) * s
        elif strip == 'deck':
            u, v = r['x'] + (a - L['zMin']) * s, r['y'] + (L['halfBeam'] - b) * s
        elif strip == 'top':
            # 頂面區沒有固定的艦體座標（每塊零件各自擺），(a, b) 是離區左上角幾公尺
            u, v = r['x'] + a * s, r['y'] + b * s
        else:
            raise ValueError(strip)
        return (u * SS, v * SS)

    def box(self, strip, bleed=0.5):
        """某一條的像素框（畫布座標），往外延伸 `bleed` 個空白"""
        r = self.R[strip]
        g = self.R['port']['x'] * bleed  # 左舷條貼著圖的左上角，它的 x 就是空白的寬
        return (round((r['x'] - g) * SS), round((r['y'] - g) * SS),
                round((r['x'] + r['w'] + g) * SS), round((r['y'] + r['h'] + g) * SS))

    # ── 量測 ────────────────────────────────────────────────────
    def hull_top(self, node, step=0.5):
        """某個網格（船殼）每一段 z 的最高點：回傳 z → y 的函式"""
        top = {}
        for f in self.faces:
            if not f['node'].startswith(node):
                continue
            for x, y, z in f['pos']:
                k = round(z / step)
                if y > top.get(k, -1e9):
                    top[k] = y
        ks = sorted(top)

        def at(z):
            k = min(ks, key=lambda q: abs(q - z / step))
            return top[k]
        at.lowest = min(top.values())
        return at

    # ── 基本圖形 ────────────────────────────────────────────────
    def fill_all(self, color):
        self.d.rectangle((0, 0, self.W * SS, self.H * SS), fill=color)

    def fill(self, strip, color):
        self.d.rectangle(self.box(strip), fill=color)

    def poly(self, strip, pts, fill):
        """填一個多邊形，**裁在這一條往外半個空白之內** —— 伸出去的部分會蓋到隔壁那一條"""
        mask = Image.new('L', self.im.size, 0)
        ImageDraw.Draw(mask).polygon([self.px(strip, a, b) for a, b in pts], fill=255)
        clip = Image.new('L', self.im.size, 0)
        ImageDraw.Draw(clip).rectangle(self.box(strip), fill=255)
        self.im.paste(fill, (0, 0, self.im.width, self.im.height), ImageChops.multiply(mask, clip))

    def rect(self, strip, a0, b0, a1, b1, fill):
        self.poly(strip, [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], fill)

    def line(self, strip, a0, b0, a1, b1, fill, width_m=0.05):
        self.d.line([self.px(strip, a0, b0), self.px(strip, a1, b1)], fill=fill,
                    width=max(1, round(width_m * self.s * SS)))

    # ── 漆面 ────────────────────────────────────────────────────
    def plates(self, strip, a0, a1, b0, b1, da, db, amount, seed):
        """鋼板一片片的深淺：a 方向每 `da`、b 方向每 `db` 一片，相鄰列錯開半片"""
        rnd = random.Random(seed)
        overlay = Image.new('L', self.im.size, 128)
        od = ImageDraw.Draw(overlay)
        row = 0
        b = b0
        while b < b1:
            a = a0 - (da / 2 if row % 2 else 0)
            while a < a1:
                k = 128 + rnd.randint(-amount, amount)
                pts = [self.px(strip, x, y) for x, y in
                       ((a, b), (a + da, b), (a + da, b + db), (a, b + db))]
                od.polygon(pts, fill=k)
                a += da
            b += db
            row += 1
        self.shade(overlay, self.box(strip))

    def seams(self, strip, a0, a1, b0, b1, da, db, color, width_m=0.03):
        """鋼板接縫：b 方向每 `db` 一條長縫，a 方向每 `da` 一條短縫、相鄰列錯開半片"""
        row = 0
        b = b0
        while b <= b1:
            self.line(strip, a0, b, a1, b, color, width_m)
            a = a0 - (da / 2 if row % 2 else 0)
            while a < a1:
                if a > a0:
                    self.line(strip, a, b, a, min(b + db, b1), color, width_m)
                a += da
            b += db
            row += 1

    def streaks(self, strip, a0, a1, top, length, color, n, seed, width_m=0.25):
        """鏽痕：從 `top` 高度往下的細長條，隨機位置與長度"""
        rnd = random.Random(seed)
        layer = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for _ in range(n):
            a = rnd.uniform(a0, a1)
            h = length * rnd.uniform(0.4, 1.0)
            w = width_m * rnd.uniform(0.5, 1.2)
            y0 = top(a)
            pts = [self.px(strip, a - w / 2, y0), self.px(strip, a + w / 2, y0),
                   self.px(strip, a + w / 4, y0 - h), self.px(strip, a - w / 4, y0 - h)]
            ld.polygon(pts, fill=color + (rnd.randint(18, 40),))
        self.im.paste(layer, (0, 0), layer)

    def shade(self, overlay, box):
        """把 128 為中性的灰階疊到 `box` 範圍：大於 128 變亮、小於變暗"""
        region = self.im.crop(box).convert('RGB')
        ov = overlay.crop(box)
        px = region.load()
        op = ov.load()
        for y in range(region.height):
            for x in range(region.width):
                k = op[x, y] - 128
                if k:
                    r, g, b = px[x, y]
                    px[x, y] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
        self.im.paste(region, box[:2])

    def top(self, color, seam, seed, da=5.0, db=1.8, amount=5):
        """頂面區：水平面的漆、鋼板深淺與接縫。上層結構、砲座、走廊的頂都讀這一區"""
        r = self.R['top']
        w, h = r['w'] / self.s, r['h'] / self.s
        self.fill('top', color)
        self.plates('top', -1, w + 1, -1, h + 1, da, db, amount, seed)
        self.seams('top', 0, w, 0, h, da, db, seam)

    # ── 輸出 ────────────────────────────────────────────────────
    def save(self, outline=None, suffix=''):
        """縮回原尺寸，寫原圖與遊戲用圖（`ship_<id><suffix>.png`）。`outline` 給一個
        路徑的話另外存一張疊了面框的檢查圖"""
        im = self.im.resize((self.W, self.H), Image.LANCZOS)
        src = os.path.join(ROOT, 'textures-src', f'ship_{self.id}{suffix}.png')
        out = os.path.join(ROOT, 'public', 'textures', f'ship_{self.id}{suffix}.png')
        for p in (src, out):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            im.save(p, optimize=True)
            print(f'{p}  {im.width}×{im.height}  {os.path.getsize(p) // 1024} KB')
        if outline is not None:
            chk = im.copy()
            cd = ImageDraw.Draw(chk)
            for f in self.faces:
                cd.polygon([tuple(p) for p in f['pts']], outline=(255, 200, 0))
            chk.save(outline)
            print(outline)
