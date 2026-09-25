# -*- coding: utf-8 -*-
"""
畫塗裝貼圖的共用工具。

版面來自 `test/tools/livery-faces.ts` 倒出的 JSON（它走遊戲裡算 UV 的同一支
`livery.ts`），這裡只照著換算：

    上下視  (a, b) = (x, z)      左右視  (a, b) = (z, y)

座標一律是機體座標（m）：X 翼展（+X 右翼）、Y 上、Z 機尾（機首在 −Z）。
每個視圖都是「站在那一側看過去」的樣子：上下視機首朝上，下視的右翼在左；
左視機首在左，右視機首在右。所以標誌、文字照圖上的正向畫就是對的。

用法見各機種的腳本（`tools/livery/<id>.py`）。
"""
import json, math, os, random
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
import export

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 先畫兩倍大再縮回來，邊緣才有抗鋸齒
SS = 2

ORIGIN = {'top': (512, 512), 'bottom': (1536, 512), 'left': (512, 1280), 'right': (1536, 1280)}
PLAN = ('top', 'bottom')
SIDE = ('left', 'right')
VIEWS = PLAN + SIDE

# 國籍標誌的顏色
US_BLUE = (28, 46, 92)
WHITE = (236, 236, 232)
BLACK = (22, 22, 24)
HINOMARU_RED = (176, 30, 34)


def shade(c, d):
    return tuple(max(0, min(255, v + d)) for v in c)


class Livery:
    def __init__(self, faces_json):
        with open(faces_json, encoding='utf-8') as f:
            meta = json.load(f)
        self.id = meta['id']
        self.W, self.H = meta['width'], meta['height']
        self.scale = meta['scale']
        self.planZ = meta['planZ']
        self.sideY = meta['sideY']
        self.faces = meta['faces']
        self.url = meta['url']
        self.im = Image.new('RGB', (self.W * SS, self.H * SS), (128, 128, 128))
        self.d = ImageDraw.Draw(self.im)

    # ── 座標換算 ────────────────────────────────────────────────
    def px(self, view, a, b):
        ox, oy = ORIGIN[view]
        s = self.scale
        if view == 'top':
            u, v = ox + a * s, oy + (b - self.planZ) * s
        elif view == 'bottom':
            u, v = ox - a * s, oy + (b - self.planZ) * s
        elif view == 'left':
            u, v = ox + (a - self.planZ) * s, oy - (b - self.sideY) * s
        else:
            u, v = ox - (a - self.planZ) * s, oy - (b - self.sideY) * s
        return (u * SS, v * SS)

    def m(self, meters):
        """公尺 → 畫布上的 px"""
        return meters * self.scale * SS

    def side_extent(self):
        """側視那一格涵蓋的 z 與 y 範圍（m）。畫大塊多邊形時用它收邊 —— 超出去的
        部分會塗到隔壁那一格，而那一格是另一個視圖"""
        hz = 512 / self.scale
        hy = 256 / self.scale
        return (self.planZ - hz, self.planZ + hz, self.sideY - hy, self.sideY + hy)

    def view_box(self, view):
        ox, oy = ORIGIN[view]
        h = 512 if view in PLAN else 256
        return ((ox - 512) * SS, (oy - h) * SS, (ox + 512) * SS, (oy + h) * SS)

    # ── 基本圖形 ────────────────────────────────────────────────
    def poly(self, view, pts, fill):
        self.d.polygon([self.px(view, a, b) for a, b in pts], fill=fill)

    def rect(self, view, a0, b0, a1, b1, fill):
        self.poly(view, [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], fill)

    def line(self, view, a0, b0, a1, b1, fill, width_m=0.018):
        self.d.line([self.px(view, a0, b0), self.px(view, a1, b1)], fill=fill,
                    width=max(1, round(self.m(width_m))))

    def fill(self, view, color):
        self.d.rectangle(self.view_box(view), fill=color)

    # ── 量測：覆蓋範圍、翼前後緣、機身輪廓 ────────────────────────
    def mask(self, view, nodes=None):
        """某視圖的覆蓋範圍（1× 解析度）。`nodes` 是節點名開頭的清單，None = 全部"""
        mk = Image.new('L', (self.W, self.H), 0)
        md = ImageDraw.Draw(mk)
        for f in self.faces:
            if f['view'] != view:
                continue
            if nodes is not None and not any(f['node'].startswith(n) for n in nodes):
                continue
            md.polygon([tuple(p) for p in f['pts']], fill=255)
        return mk

    def wing_edges(self, nodes, x0, x1, step=0.05):
        """上視裡主翼的前後緣：回傳 |x| → (z 前緣, z 後緣) 的函式"""
        mk = self.mask('top', nodes).load()
        table = {}
        k = 0
        while x0 + k * step <= x1:
            x = x0 + k * step
            u, _ = self.px('top', x, 0)
            u = int(u / SS)
            rows = [v for v in range(0, 1024) if mk[u, v]]
            if rows:
                z_le = (min(rows) - ORIGIN['top'][1]) / self.scale + self.planZ
                z_te = (max(rows) - ORIGIN['top'][1]) / self.scale + self.planZ
                table[round(x, 3)] = (z_le, z_te)
            k += 1
        ks = sorted(table)

        def at(x):
            x = min(max(abs(x), ks[0]), ks[-1])
            for a, b in zip(ks, ks[1:]):
                if a <= x <= b:
                    t = (x - a) / (b - a)
                    return tuple(table[a][i] + (table[b][i] - table[a][i]) * t for i in (0, 1))
            return table[ks[-1]]
        return at

    def fuselage_profile(self, nodes, smooth=0.6):
        """左視裡機身的上下緣：回傳 z → (y 下緣, y 上緣) 的函式，沿 z 平滑過"""
        mk = self.mask('left', nodes).load()
        raw = {}
        for u in range(0, 1024):
            rows = [v for v in range(1024, 1536) if mk[u, v]]
            if rows:
                z = (u - ORIGIN['left'][0]) / self.scale + self.planZ
                y_top = -(min(rows) - ORIGIN['left'][1]) / self.scale + self.sideY
                y_bot = -(max(rows) - ORIGIN['left'][1]) / self.scale + self.sideY
                raw[z] = (y_bot, y_top)
        zs = sorted(raw)
        out = {}
        for z in zs:
            near = [raw[w] for w in zs if abs(w - z) <= smooth]
            out[z] = (sum(n[0] for n in near) / len(near), sum(n[1] for n in near) / len(near))

        def at(z):
            z = min(max(z, zs[0]), zs[-1])
            best = min(zs, key=lambda w: abs(w - z))
            return out[best]
        at.z0, at.z1 = zs[0], zs[-1]
        return at

    def edge_strip(self, views, edges, x0, x1, depth, color, sides=(-1, 1), trailing=False):
        """沿翼前緣（或後緣）畫一條帶子：|x| 從 x0 到 x1、往弦內 depth 公尺"""
        for view in views:
            for side in sides:
                xs = [x0 + (x1 - x0) * k / 20 for k in range(21)]
                if trailing:
                    outer = [(side * x, edges(x)[1]) for x in xs]
                    inner = [(side * x, edges(x)[1] - depth) for x in reversed(xs)]
                else:
                    outer = [(side * x, edges(x)[0]) for x in xs]
                    inner = [(side * x, edges(x)[0] + depth) for x in reversed(xs)]
                self.poly(view, outer + inner, color)

    # ── 漆面 ────────────────────────────────────────────────────
    def countershade(self, top, bottom, profile, frac, wave=0.0, seed=1):
        """上下分色：上視全上色、下視全下色，側視照機身輪廓的 frac 高度分界。
        `wave` 是分界線的起伏振幅（m），給手噴的軟邊用"""
        self.fill('top', top)
        self.fill('bottom', bottom)
        rnd = random.Random(seed)
        phase = rnd.random() * 10
        z0, z1, _, y1 = self.side_extent()
        for view in SIDE:
            self.fill(view, bottom)
            pts = []
            z = z0
            while z <= z1:
                yb, yt = profile(z)
                y = yb + frac * (yt - yb) + wave * math.sin(z * 2.3 + phase)
                pts.append((z, min(y, y1)))
                z += 0.05
            pts += [(z1, y1), (z0, y1)]
            self.poly(view, pts, top)

    def panels(self, views, dz, dy, amount, seed=51):
        """蒙皮分片：每片深淺差一點。會蓋掉底色的明暗，所以畫在底色之後、塗裝之前"""
        rnd = random.Random(seed)
        overlay = Image.new('L', self.im.size, 128)
        od = ImageDraw.Draw(overlay)
        for view in views:
            x0, y0, x1, y1 = self.view_box(view)
            sx, sy = self.m(dz), self.m(dy)
            j = 0
            while y0 + j * sy < y1:
                i = 0
                while x0 + i * sx < x1:
                    od.rectangle([x0 + i * sx, y0 + j * sy, x0 + (i + 1) * sx, y0 + (j + 1) * sy],
                                 fill=128 + rnd.randint(-amount, amount))
                    i += 1
                j += 1
        up = overlay.point(lambda v: max(0, v - 128))
        down = overlay.point(lambda v: max(0, 128 - v))
        self.im = ImageChops.subtract(ImageChops.add(self.im, Image.merge('RGB', (up,) * 3)),
                                      Image.merge('RGB', (down,) * 3))
        self.d = ImageDraw.Draw(self.im)

    def splinter(self, view, colors, n_lines, seed, clip=None):
        """碎片迷彩：畫幾條隨機直線，用「越過幾條線」的奇偶上兩色 —— 直線切出來的
        區塊一定能這樣兩色塗開，塊與塊的邊都是直的。`clip` 是只蓋這一塊的遮罩"""
        rnd = random.Random(seed)
        x0, y0, x1, y1 = self.view_box(view)
        w, h = int(x1 - x0), int(y1 - y0)
        lines = []
        for _ in range(n_lines):
            t = rnd.uniform(0, math.pi)
            c = (rnd.uniform(0, w), rnd.uniform(0, h))
            lines.append((math.cos(t), math.sin(t), c))
        layer = Image.new('RGB', (w, h))
        lp = layer.load()
        # 每 4 px 算一次再放大，省時間；塊很大，看不出差別
        step = 4
        small = Image.new('RGB', (w // step + 1, h // step + 1))
        sp = small.load()
        for j in range(h // step + 1):
            for i in range(w // step + 1):
                x, y = i * step, j * step
                k = sum(1 for (cx, cy, c) in lines if (x - c[0]) * -cy + (y - c[1]) * cx > 0)
                sp[i, j] = colors[k % 2]
        layer = small.resize((w, h), Image.NEAREST)
        if clip is None:
            self.im.paste(layer, (int(x0), int(y0)))
        else:
            self.im.paste(layer, (int(x0), int(y0)), clip.crop((int(x0), int(y0), int(x0) + w, int(y0) + h)))

    def side_above(self, profile, frac):
        """側視裡分界線以上的遮罩（畫布解析度），給碎片迷彩、斑點裁切用"""
        mk = Image.new('L', self.im.size, 0)
        md = ImageDraw.Draw(mk)
        z0, z1, _, y1 = self.side_extent()
        for view in SIDE:
            pts = []
            z = z0
            while z <= z1:
                yb, yt = profile(z)
                pts.append(self.px(view, z, min(y1, yb + frac * (yt - yb))))
                z += 0.05
            pts += [self.px(view, z1, y1), self.px(view, z0, y1)]
            md.polygon(pts, fill=255)
        return mk

    def mottle(self, views, colors, count, radius_m, seed, clip=None, blur_m=0.03):
        """斑點：一堆軟邊的小圓，給德國機的機身側面"""
        rnd = random.Random(seed)
        layer = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for view in views:
            x0, y0, x1, y1 = self.view_box(view)
            for _ in range(count):
                cx, cy = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
                r = self.m(radius_m) * rnd.uniform(0.5, 1.3)
                c = rnd.choice(colors)
                ld.ellipse([cx - r, cy - r * rnd.uniform(0.6, 1.0), cx + r, cy + r], fill=c + (255,))
        layer = layer.filter(ImageFilter.GaussianBlur(self.m(blur_m)))
        if clip is not None:
            a = layer.getchannel('A')
            a = Image.composite(a, Image.new('L', a.size, 0), clip)
            layer.putalpha(a)
        self.im.paste(layer, (0, 0), layer)

    # ── 標誌與文字：cx, cy 是機體座標，在 view 裡居中 ───────────────
    def us_star(self, view, a, b, r_m, bars=True):
        """美軍國籍標誌。bars=False 是 1942 年那種只有圓裡一顆星"""
        cx, cy = self.px(view, a, b)
        r = self.m(r_m)
        d = self.d
        o = r / 8
        if bars:
            d.ellipse([cx - r - o, cy - r - o, cx + r + o, cy + r + o], fill=US_BLUE)
            d.rectangle([cx - 2 * r - o, cy - r / 4 - o, cx + 2 * r + o, cy + r / 4 + o], fill=US_BLUE)
            d.rectangle([cx - 2 * r, cy - r / 4, cx + 2 * r, cy + r / 4], fill=WHITE)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=US_BLUE)
        pts = []
        for k in range(10):
            rr = r if k % 2 == 0 else r * 0.382
            t = -math.pi / 2 + k * math.pi / 5
            pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
        d.polygon(pts, fill=WHITE)

    def balkenkreuz(self, view, a, b, size_m, style='full'):
        """德軍十字。size 是整個十字的寬。
        style：'full' 黑十字白邊；'outline' 只有白邊（後期機背的簡化樣式）"""
        cx, cy = self.px(view, a, b)
        s = self.m(size_m) / 2
        arm = s / 4          # 黑十字臂的半寬
        edge = s / 8         # 白邊寬
        d = self.d

        def cross(half_len, half_w, color):
            d.rectangle([cx - half_len, cy - half_w, cx + half_len, cy + half_w], fill=color)
            d.rectangle([cx - half_w, cy - half_len, cx + half_w, cy + half_len], fill=color)

        if style == 'full':
            cross(s, arm + edge, WHITE)
            cross(s - edge, arm, BLACK)
        else:
            # 白色外框，裡面留底色：外框是四個 L 形，用粗線描出來
            w = max(2, edge * 0.8)
            pts = [(-arm - edge, -s), (arm + edge, -s), (arm + edge, -arm - edge), (s, -arm - edge),
                   (s, arm + edge), (arm + edge, arm + edge), (arm + edge, s), (-arm - edge, s),
                   (-arm - edge, arm + edge), (-s, arm + edge), (-s, -arm - edge), (-arm - edge, -arm - edge)]
            pts = [(cx + p[0], cy + p[1]) for p in pts]
            d.line(pts + [pts[0]], fill=WHITE, width=int(w), joint='curve')

    def hinomaru(self, view, a, b, r_m, border=0.0):
        """日之丸。border 是白邊寬（m），0 = 沒有白邊"""
        cx, cy = self.px(view, a, b)
        r = self.m(r_m)
        if border > 0:
            o = self.m(border)
            self.d.ellipse([cx - r - o, cy - r - o, cx + r + o, cy + r + o], fill=WHITE)
        self.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=HINOMARU_RED)

    def text(self, view, a, b, s, height_m, color, outline=None, outline_m=0.02):
        cx, cy = self.px(view, a, b)
        h = self.m(height_m)
        font = ImageFont.truetype('arialbd.ttf', int(h * 1.36))
        box = self.d.textbbox((0, 0), s, font=font)
        w, hh = box[2] - box[0], box[3] - box[1]
        pos = (cx - w / 2 - box[0], cy - hh / 2 - box[1])
        if outline is not None:
            self.d.text(pos, s, font=font, fill=color, stroke_width=max(1, int(self.m(outline_m))),
                        stroke_fill=outline)
        else:
            self.d.text(pos, s, font=font, fill=color)

    # ── 輸出 ────────────────────────────────────────────────────
    def save(self):
        """原圖寫進 textures-src/，再照 export.py 的尺寸表產生遊戲用圖"""
        name = os.path.basename(self.url)
        src = os.path.join(export.SRC, name)
        os.makedirs(export.SRC, exist_ok=True)
        self.im.resize((self.W, self.H), Image.LANCZOS).save(src, optimize=True)
        print(src, os.path.getsize(src) // 1024, 'KB')
        export.export(os.path.splitext(name)[0])
