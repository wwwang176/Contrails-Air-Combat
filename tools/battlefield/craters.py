# 這張圖集是戰場地面的彈坑、燒田、履帶痕與壕溝（`src/render/battleScars.ts` 讀它），適合從空中俯視。
# 1024 × 1024 圖集分成 4 × 4 格：0～7 為彈坑、8～11 為燒田、
# 12～13 為可上下接續的履帶痕、14～15 為可上下接續的白堊土壕溝。
# 白堊濺土採低飽和灰白色；透明護邊避免相鄰格子的取樣互相污染。
# 在 repo 根目錄執行 python tools/battlefield/craters.py 即可重建兩份
# battlefield.png 與麥金色底的預覽圖；固定亂數種子確保同環境重跑一致。

from pathlib import Path
import hashlib
import shutil

import numpy as np
from PIL import Image


SEED = 19430712
SIZE = 256
SCALE = 3
N = SIZE * SCALE
ROOT = Path(__file__).resolve().parents[2]
Y, X = np.mgrid[:N, :N].astype(np.float32) / SCALE + 0.5 / SCALE


def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise(rng, cells, periodic=False):
    data = rng.random((cells, cells)).astype(np.float32)
    if periodic:
        # 平鋪後取中間區域，插值也會跨越上下邊界。
        data = np.tile(data, (3, 3))
        enlarged = Image.fromarray(data).resize((N * 3, N * 3), Image.Resampling.BICUBIC)
        return np.asarray(enlarged)[N:2 * N, N:2 * N].copy()
    return np.asarray(Image.fromarray(data).resize((N, N), Image.Resampling.BICUBIC))


class Tile:
    def __init__(self):
        self.rgb = np.zeros((N, N, 3), dtype=np.float32)
        self.alpha = np.zeros((N, N), dtype=np.float32)

    def paint(self, color, alpha):
        alpha = np.clip(alpha, 0, 1)
        color = np.asarray(color, dtype=np.float32)
        if color.ndim == 2:
            color = color[..., None]
        self.rgb = color * alpha[..., None] + self.rgb * (1 - alpha[..., None])
        self.alpha = alpha + self.alpha * (1 - alpha)

    def finish(self, periodic=False):
        guard = smooth(5, 10, np.minimum(X, SIZE - X))
        if not periodic:
            guard *= smooth(5, 10, np.minimum(Y, SIZE - Y))
        self.rgb *= guard[..., None]
        self.alpha *= guard
        # 在預乘空間濾波避免黑邊；存檔前還原成直的 alpha。
        def shrink(channel):
            if periodic:
                padded = np.concatenate((channel, channel, channel), axis=0)
                reduced = Image.fromarray(padded).resize((SIZE, SIZE * 3), Image.Resampling.LANCZOS)
                return np.asarray(reduced)[SIZE:2 * SIZE].copy()
            return np.asarray(Image.fromarray(channel).resize((SIZE, SIZE), Image.Resampling.LANCZOS)).copy()

        alpha = np.clip(shrink(self.alpha), 0, 1)
        rgb = np.stack([shrink(self.rgb[..., c]) for c in range(3)], axis=-1)
        if periodic:
            # 邊界樣本相同，雙線性取樣跨格接續時不會出現跳色。
            alpha[0] = alpha[-1] = (alpha[0] + alpha[-1]) * 0.5
            rgb[0] = rgb[-1] = (rgb[0] + rgb[-1]) * 0.5
        rgb /= np.maximum(alpha[..., None], 1e-8)
        result = np.dstack((np.clip(rgb, 0, 255), alpha * 255)).round().astype(np.uint8)
        result[:, :4] = result[:, -4:] = 0
        if not periodic:
            result[:4] = result[-4:] = 0
        result[result[..., 3] == 0] = 0
        return Image.fromarray(result)


def crater(tile, rng, cx, cy, radius, angle, fresh):
    coarse = noise(rng, 18)
    grain = noise(rng, 155)
    dx, dy = X - cx, Y - cy
    u = (dx * np.cos(angle) + dy * np.sin(angle)) / radius
    v = (-dx * np.sin(angle) + dy * np.cos(angle)) / (radius * 0.83)
    theta = np.arctan2(v, u)
    phase = rng.uniform(0, 6.28, 4)
    outline = 1 + 0.055 * np.sin(theta * 5 + phase[0]) + 0.038 * np.sin(theta * 9 + phase[1])
    r = np.hypot(u, v) / outline
    rays = (0.5 + 0.5 * np.sin(theta * 23 + phase[2] + np.sin(theta * 7))) ** 5
    rays += 0.5 * (0.5 + 0.5 * np.sin(theta * 41 + phase[3])) ** 12
    halo = (1 - smooth(0.85, 1.85, r)) * smooth(0.7, 1.05, r)
    tile.paint([99, 91, 70], halo * 0.22)
    ejecta = smooth(0.72, 1.04, r) * (1 - smooth(1.1, 1.95, r))
    ejecta *= np.clip((coarse - 0.22) * 1.5 + rays * 0.6, 0, 1)
    chalk = np.array([181, 177, 158] if fresh else [127, 123, 104])
    tile.paint(chalk + ((grain - 0.5) * 29)[..., None], ejecta * (0.88 if fresh else 0.55))
    # 放射狀細長土塊與碎屑，離中心越遠越稀薄。
    for _ in range(100 if fresh else 65):
        a = rng.uniform(0, np.pi * 2)
        distance = rng.uniform(0.95, 1.86)
        px = cx + np.cos(a) * radius * distance
        py = cy + np.sin(a) * radius * distance * 0.83
        length = rng.uniform(0.8, 5.0) * radius / 45
        width = rng.uniform(0.45, 1.6) * radius / 45
        along = (X - px) * np.cos(a) + (Y - py) * np.sin(a)
        across = -(X - px) * np.sin(a) + (Y - py) * np.cos(a)
        shape = np.sqrt((along / length) ** 2 + (across / width) ** 2)
        tile.paint(chalk + rng.uniform(-16, 22), (1 - smooth(0.35, 1.3, shape)) * (2 - distance) * 0.6)
    edge = r + (coarse - 0.5) * (0.075 if fresh else 0.13)
    rim = np.exp(-((edge - 0.91) / (0.105 if fresh else 0.16)) ** 2)
    light = -(u + v) / np.maximum(np.hypot(u, v), 0.01) / 1.414
    rim_color = np.array([145, 136, 112] if fresh else [104, 99, 79])
    tile.paint(rim_color + (light * 27 + (grain - 0.5) * 35)[..., None], rim * 0.96)
    pit = 1 - smooth(0.70 if fresh else 0.64, 0.86 if fresh else 0.9, edge)
    # 左上坑壁遮蔽光線；右下內壁較亮，坑底最暗。
    wall = smooth(0.24, 0.83, r)
    inside = np.array([30, 27, 22]) + (wall * (18 - light * 13) + (grain - 0.5) * 12)[..., None]
    tile.paint(inside, pit * 0.98)


def make_crater(index, rng):
    tile = Tile()
    # 半徑含外部濺土後，小坑約佔 40%，大坑約佔 85%。
    specs = [(28, 0.2, True), (58, 0.8, True), (43, 1.7, True),
             (46, 2.4, False), (41, -0.5, True), (51, 1.1, False),
             (35, 2.8, True), (48, -1.0, False)]
    radius, angle, fresh = specs[index]
    if index == 4:
        crater(tile, rng, 99, 113, 38, 0.5, False)
        crater(tile, rng, 153, 145, 37, -0.5, True)
    else:
        crater(tile, rng, 128 + rng.uniform(-5, 5), 128 + rng.uniform(-5, 5), radius, angle, fresh)
    return tile.finish()


def make_burn(index, rng):
    tile = Tile()
    coarse, medium, grain = noise(rng, 9), noise(rng, 35), noise(rng, 190)
    angle = [0.3, 1.2, -0.7, 2.0][index]
    u = (X - 128) * np.cos(angle) + (Y - 128) * np.sin(angle)
    v = -(X - 128) * np.sin(angle) + (Y - 128) * np.cos(angle)
    field = np.full((N, N), -100.0, np.float32)
    # 角向雜訊讓半徑以半格寬的 70% 為平均，在 55%～85% 內起伏。
    theta = np.arctan2(v, u)
    phase = rng.uniform(0, 2 * np.pi, 4)
    wobble = (0.48 * np.sin(3 * theta + phase[0])
              + 0.28 * np.sin(5 * theta + phase[1])
              + 0.16 * np.sin(8 * theta + phase[2])
              + 0.08 * np.sin(13 * theta + phase[3]))
    radius = SIZE * 0.5 * (0.70 + 0.15 * wobble)
    radial = np.hypot(u, v) / radius
    mask = 1 - smooth(0.58, 1.0, radial)
    # 負值背景不著色；相疊的燒痕與雜訊形成不規則的深褐邊緣。
    for cx, cy, rx, ry in [(-38, -14, 49, 30), (12, 5, 60, 42), (46, -24, 34, 26), (-8, 36, 36, 30)]:
        cx += rng.uniform(-12, 12)
        cy += rng.uniform(-12, 12)
        field = np.maximum(field, 1 - ((u - cx) / rx) ** 2 - ((v - cy) / ry) ** 2)
    broken = field + (coarse - 0.5) * 1.15 + (medium - 0.5) * 0.46
    core = 1 - smooth(0.12, 0.70, radial)
    coverage = np.maximum(smooth(-0.10, 0.45, broken), core)
    tile.paint([66, 46, 28], coverage * (1 - smooth(0.68, 0.88, radial)) * 0.85)
    char = np.maximum(smooth(0.05, 0.68, broken) * (1 - smooth(0.35, 0.78, radial)), core)
    tile.paint(np.array([23, 21, 18]) + ((grain - 0.5) * 12)[..., None], char * 0.98)
    # 外圍只留下零星的小焦點，未燒到的空隙保持透明。
    for _ in range(300):
        px, py = rng.uniform(27, 229, 2)
        ix, iy = int(px * SCALE), int(py * SCALE)
        if 0.65 < radial[iy, ix] < 0.98:
            d = ((X - px) / rng.uniform(0.6, 2.5)) ** 2 + ((Y - py) / rng.uniform(0.6, 3)) ** 2
            tile.paint([41, 36, 28], (1 - smooth(0.3, 1.4, d)) * 0.7)
    # 預乘色彩與透明度一起套用遮罩，縮圖後保留八像素全透明護邊。
    tile.rgb *= mask[..., None]
    tile.alpha *= mask
    result = np.array(tile.finish())
    result[:8] = result[-8:] = 0
    result[:, :8] = result[:, -8:] = 0
    # 低透明度的重採樣色彩限制於焦黑與深褐色域。
    result[..., :3] = np.minimum(result[..., :3], [66, 46, 28])
    return Image.fromarray(result)


def make_tracks(index, rng):
    tile = Tile()
    coarse, grain = noise(rng, 24, True), noise(rng, 170, True)
    bend = (6 if index == 0 else 13) * np.sin(2 * np.pi * Y / SIZE)
    bend += 2 * np.sin(4 * np.pi * Y / SIZE)
    for center in (128 - SIZE * 0.175, 128 + SIZE * 0.175):
        dx = X - center - bend
        distance = np.abs(dx)
        tile.paint([108, 95, 64], (1 - smooth(10, 18, distance)) * 0.35)
        track = 1 - smooth(7 + coarse * 2, 11 + coarse * 3, distance)
        tile.paint(np.array([66, 59, 42]) + ((grain - 0.5) * 22)[..., None], track * (0.63 + coarse * 0.2))
        tread = (0.5 + 0.5 * np.cos(2 * np.pi * (Y * 32 / SIZE + dx * 0.028))) ** 9
        tile.paint([39, 37, 29], tread * track * 0.6)
        tile.paint([135, 121, 84], np.exp(-((distance - 12) / 1.3) ** 2) * 0.2)
    return tile.finish(periodic=True)


def make_trench(index, rng):
    tile = Tile()
    coarse, grain = noise(rng, 24, True), noise(rng, 180, True)
    phase = Y / SIZE * (2 if index == 0 else 3) + (0.13 if index else 0)
    triangle = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * phase))
    center = 128 + (23 if index == 0 else 29) * triangle
    dx = X - center
    d = np.abs(dx) + (coarse - 0.5) * 4
    tile.paint([118, 108, 80], (1 - smooth(27, 44, d)) * 0.3)
    bank = np.exp(-((d - 23) / 9) ** 2) * (0.55 + coarse * 0.45)
    tile.paint(np.array([180, 175, 153]) + ((grain - 0.5) * 35 + np.where(dx < 0, 6, -10))[..., None], bank * 0.94)
    scatter = smooth(0.52, 0.8, coarse) * (1 - smooth(30, 44, d)) * smooth(25, 31, d)
    tile.paint([170, 166, 146], scatter * 0.7)
    tile.paint([94, 85, 65], (1 - smooth(14, 18, d)) * 0.98)
    tile.paint(np.array([32, 30, 24]) + (np.clip(dx / 15, -1, 1) * 8 + (grain - 0.5) * 10)[..., None], (1 - smooth(11, 15, d)) * 0.98)
    return tile.finish(periodic=True)


def validate(atlas):
    pixels = np.asarray(atlas)
    assert atlas.mode == 'RGBA' and atlas.size == (1024, 1024)
    for index in range(16):
        row, col = divmod(index, 4)
        tile = pixels[row * SIZE:(row + 1) * SIZE, col * SIZE:(col + 1) * SIZE]
        assert not tile[:, :4, 3].any() and not tile[:, -4:, 3].any()
        assert np.any((tile[..., 3] > 0) & (tile[..., 3] < 255))
        if index < 12:
            assert not tile[:4, :, 3].any() and not tile[-4:, :, 3].any()
        else:
            assert np.array_equal(tile[0], tile[-1]), f'第 {index} 格接縫不一致'
        assert not tile[tile[..., 3] == 0, :3].any()
        if 8 <= index < 12:
            assert not tile[:8, :, 3].any() and not tile[-8:, :, 3].any()
            assert not tile[:, :8, 3].any() and not tile[:, -8:, 3].any()


def main():
    atlas = Image.new('RGBA', (1024, 1024))
    for index in range(16):
        rng = np.random.default_rng(SEED + index)
        if index < 8:
            tile = make_crater(index, rng)
        elif index < 12:
            tile = make_burn(index - 8, rng)
        elif index < 14:
            tile = make_tracks(index - 12, rng)
        else:
            tile = make_trench(index - 14, rng)
        atlas.paste(tile, ((index % 4) * SIZE, (index // 4) * SIZE))
    validate(atlas)
    source = ROOT / 'textures-src/battlefield.png'
    target = ROOT / 'public/textures/battlefield.png'
    preview = ROOT / 'textures-src/battlefield_preview.png'
    source.parent.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(source)
    shutil.copyfile(source, target)
    rng = np.random.default_rng(SEED)
    background = np.array([185, 163, 90]) + rng.normal(0, 2.1, (1024, 1024, 1))
    background = Image.fromarray(np.clip(background, 0, 255).round().astype(np.uint8)).convert('RGBA')
    Image.alpha_composite(background, atlas).convert('RGB').save(preview)
    assert source.read_bytes() == target.read_bytes()
    for path in (source, target, preview):
        with Image.open(path) as saved:
            saved.load()
            assert saved.size == (1024, 1024)
        print(f'{path.relative_to(ROOT)}  sha256={hashlib.sha256(path.read_bytes()).hexdigest()}')
    print('Validated: RGBA, transparent gutters, soft alpha, seamless vertical endpoints, identical atlas copies.')


if __name__ == '__main__':
    main()
