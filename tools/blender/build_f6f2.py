# -*- coding: utf-8 -*-
"""
lowpoly F6F-5 Hellcat —— **Blender 原生做法**的第二版。

第一版是把專案裡 TypeScript 那套（算好整份頂點與面索引，再一次倒進 mesh）
逐行搬過來。結果能看，但有兩個問題：

  1. 產出是**烘死的**。左右各一份頂點、洞是「跳過那幾個面」跳出來的，
     在 Blender 裡想動一點就得回頭改 Python 再整個重建。
  2. 沒有用到 Blender 真正擅長的東西。

這一版改成：

  ── 只建一半，左右交給 Mirror 修改器 ──────────────────────────
     機身、主翼、水平尾翼、垂尾都只建 x ≥ 0 的一半，靠 Mirror 合起來。
     頂點少一半，而且改一邊兩邊都跟著動。

  ── 面用 bmesh 的 bridge_loops 串，不自己算索引 ──────────
     `bmesh.ops.bridge_loops` 就是 lofting。自己寫 `[i*n+k, ...]`
     那種索引算式是第一版機身與垂尾**法線整個朝內**的來源。

  ── 基本體用 bmesh.ops.create_cone / create_cube ────────────
     整流罩與槳葉不必手刻。

  ── 座艙：**先畫玻璃，再讓機身去貼合** ────────────────────────
     這是專案負責人的裁決（技能坑 57）。玻璃是**輸入**：先照量測值把罩子
     建出來，再由罩子的底緣長出一個 Boolean 切刀，用 Boolean 修改器在機身
     上挖洞。洞的邊界因此**恆等於**玻璃的底緣 —— 不是兩邊各自逼近然後希望
     它們對得上（第一版就是那樣，後段開口比罩子寬 0.19 m）。

     而且 Boolean 是修改器：把 `F6F_CockpitCutter` 往後拉 10 cm，洞就跟著
     變，機身不必重建。

所有尺寸量自 ref/f6f.glb（已清理對齊）。座標是**機體座標**：X 翼展、
Y 向上、Z 向機尾（機首在 −Z），原點是機翼四分之一弦線。
Blender 是 Z 向上，所以 (x, y, z) → (x, −z, y)。
"""
import bpy
import bmesh
import math
from mathutils import Matrix, Vector

# ═════════════════════════════════════════════════════════════════════
# 量測值
# ═════════════════════════════════════════════════════════════════════
N_EXP = 2.18          # 機身剖面的超橢圓指數，18 個乾淨站位的共識
# 【預算對齊 P-51D】遊戲裡那台是每半圈 8 點、36 站，全機 2,703 個三角形。
# 這台先做過 1 萬版（每半圈 17 點、100 站）確認形狀，再把密度降回同級。
# 形狀不會變 —— 錨點曲線是連續的，站數只決定取樣多密。
RING_PTS = 12         # 每半圈；整圈 2×12−2 = 22 點
STATIONS = 33         # 由 46 個量測站取樣
# 【點不要沿角度等分】機背整流只佔中線兩側 |x| < 0.40，而機身半寬有 0.68。
# 角度等分時那一段只分到 2 個點，整流罩就只能長成一塊平頂的板 —— 那正是側視
# 看到的「機背多一層階梯」。把參數 s 用 s**1.2 往頂端擠，同樣的點數在 x <
# 0.40 內由 2 個變 3 個，腹線那側每步 19° 仍然夠平順。
RING_WARP = 1.2

#        Zb       a      back    belly     cy
HULL = [
    # ── 機首：cowl 是鈍的。−2.40／−2.35 那兩站量到的是進氣開口的**內唇**，
    #    −2.30 才是前端鈍面（半寬一步由 0.117 跳到 0.536）。
    (-2.320, 0.520,  0.640, -0.420,  0.038),
    (-2.270, 0.552,  0.672, -0.560,  0.037),
    (-2.220, 0.585,  0.712, -0.727,  0.036),   # 下巴進氣口讓腹線一步加深
    (-2.150, 0.611,  0.744, -0.754,  0.034),
    (-2.050, 0.645,  0.792, -0.791,  0.031),
    (-1.950, 0.665,  0.813, -0.819,  0.028),
    (-1.850, 0.677,  0.830, -0.833,  0.025),
    (-1.749, 0.689,  0.846, -0.845,  0.022),
    (-1.551, 0.716,  0.883, -0.874,  0.017),
    (-1.353, 0.735,  0.917, -0.902,  0.011),
    # 【Zb −1.16…0.23 的背線是直接量的，不是反解的】前一版這一段用「離軸
    #  0.72a ＋ 超橢圓」反解，做出一片 1.02 的平台；正上方直接量是一條乾淨
    #  的斜坡（−1.0 的 0.979 升到 0.20 的 1.076，斜率 0.081/m），終點正好是
    #  風擋前框的頂 1.083。反解在這一段系統性偏低 0.04–0.06，機背因此少了
    #  往風擋抬上去的那一段。
    (-1.155, 0.735,   0.952, -0.927,  0.006),
    (-0.958, 0.726,   0.982, -0.947,  0.001),
    (-0.760, 0.731,   0.998, -0.956, -0.005),
    (-0.562, 0.751,   1.014, -0.958, -0.010),
    (-0.364, 0.764,   1.030, -0.958, -0.016),
    (-0.166, 0.765,   1.046, -0.958, -0.021),
    ( 0.031, 0.760,   1.062, -0.958, -0.027),
    ( 0.229, 0.755,   1.078, -0.958, -0.032),
    # 【座艙段的背線是「讓艙緣剛好落在機身上」反推的】這一段本體被切掉，
    #  背線只決定艙緣外側那圈 coaming 的高度。逐站驗過：超橢圓要通過
    #  (艙緣x, 艙緣y) 需要的背線是 0.946/0.976/0.992/0.979/0.970/0.955，
    #  這裡取的值都不低於它 —— 低了玻璃下緣會浮在蒙皮上方，那就是縫。
    ( 0.427, 0.753,   1.070, -0.957, -0.038),
    ( 0.625, 0.752,   1.046, -0.957, -0.043),
    ( 0.822, 0.745,   1.019, -0.954, -0.049),
    ( 1.020, 0.730,   0.995, -0.948, -0.054),
    ( 1.218, 0.712,   0.978, -0.939, -0.060),
    ( 1.416, 0.696,   0.962, -0.930, -0.065),
    ( 1.614, 0.681,   0.946, -0.921, -0.071),
    ( 1.811, 0.666,   0.938, -0.912, -0.076),
    ( 2.009, 0.652,   0.928, -0.903, -0.082),
    ( 2.207, 0.638,   0.914, -0.894, -0.087),
    ( 2.405, 0.621,   0.904, -0.882, -0.093),
    ( 2.602, 0.603,   0.862, -0.867, -0.098),
    ( 2.800, 0.582,   0.812, -0.849, -0.104),
    ( 2.998, 0.561,   0.762, -0.830, -0.109),
    ( 3.196, 0.539,   0.714, -0.812, -0.115),
    ( 3.394, 0.517,   0.665, -0.793, -0.120),
    ( 3.591, 0.496,   0.616, -0.774, -0.126),
    ( 3.789, 0.474,   0.567, -0.755, -0.131),
    ( 3.987, 0.452,   0.518, -0.736, -0.137),
    ( 4.185, 0.428,   0.472, -0.717, -0.142),
    ( 4.382, 0.403,   0.428, -0.698, -0.148),
    ( 4.580, 0.377,   0.384, -0.679, -0.153),
    ( 4.778, 0.362,   0.341, -0.655, -0.159),
    ( 4.976, 0.338,   0.297, -0.632, -0.164),
    # ── 尾段：**整段重量過**。上一版這裡的腹線是從尾輪艙的假訊號外推的
    #    —— 正下方的射線由艙口穿進去打到對側，讀出來的腹線一路往上翹，到
    #    Zb 6.43 已經高了 0.22 m，機尾因此收成一根針。改用**側向**射線掃
    #    (Zb, Yb) 取最外側：艙口不在側面，量得到真的殼。
    #
    #    腹線幾乎是直的：−0.652 @4.80 → −0.393 @7.00（0.117/m）。
    #    半寬也是線性：0.359 @4.80 → 0.100 @7.00（−0.120/m）。
    #    尾柱在 Zb 7.15（再往後是方向舵，另一個物件），比上一版多 0.45 m。
    ( 5.130, 0.319,   0.263, -0.614, -0.169),
    ( 5.260, 0.304,   0.234, -0.599, -0.174),
    ( 5.390, 0.288,   0.203, -0.583, -0.179),
    ( 5.520, 0.272,   0.176, -0.568, -0.184),
    ( 5.650, 0.257,   0.148, -0.553, -0.190),
    ( 5.780, 0.241,   0.119, -0.538, -0.196),
    ( 5.910, 0.225,   0.090, -0.522, -0.202),
    ( 6.040, 0.210,   0.061, -0.507, -0.208),
    ( 6.170, 0.194,   0.031, -0.492, -0.214),
    ( 6.300, 0.179,   0.000, -0.477, -0.220),
    ( 6.430, 0.163,  -0.030, -0.461, -0.227),
    ( 6.560, 0.148,  -0.062, -0.446, -0.234),
    ( 6.700, 0.131,  -0.098, -0.430, -0.241),
    ( 6.830, 0.115,  -0.135, -0.415, -0.248),
    ( 6.960, 0.100,  -0.177, -0.399, -0.256),
    ( 7.090, 0.073,  -0.222, -0.384, -0.264),
    ( 7.150, 0.048,  -0.250, -0.375, -0.270),
]


def smooth_hull(rows, passes=6, lam=0.5, keep=0.07, skip_front=4):
    """
    **z 不等距的拉普拉斯平滑**（技能第 4 步）。把每一站往「前後兩站在該 z 的
    連線」拉 λ。站距不等距時不能用等權的 [.25, .5, .25] —— 那會把密集區壓扁。

    【為什麼非做不可】不平滑的錨點表，背線有 9/53 站的相鄰斜率變化超過 4°，
    最糟的兩處是 +13.80° 與 −15.82°（把「舊的中線值」與「反解的本體值」接
    起來的地方），腹線在尾錐是 +19.14° / −18.72°。平面著色下那就是一圈一圈
    的橫向摺痕。

    【保邊：門檻訂在「要保住的特徵，相鄰兩站差多少」】（坑 44）機首的 cowl
    前緣與下巴進氣口是真的特徵 —— 腹線在 Zb −2.22 一步走 0.17。門檻 0.07
    讓那一段原封不動，其餘照平滑。前 `skip_front` 站整個不碰。
    """
    rows = [list(r) for r in rows]
    for _ in range(passes):
        src = [list(r) for r in rows]
        for i in range(max(1, skip_front), len(rows) - 1):
            p_, c_, q_ = src[i - 1], src[i], src[i + 1]
            t = (c_[0] - p_[0]) / (q_[0] - p_[0])
            for k in range(1, len(c_)):
                lin = p_[k] + (q_[k] - p_[k]) * t
                if abs(c_[k] - lin) > keep:
                    continue                     # 真的特徵，不動
                rows[i][k] = c_[k] + lam * (lin - c_[k])
    return [tuple(r) for r in rows]


HULL = smooth_hull(HULL)

# ── 座艙玻璃 ────────────────────────────────────────────────────────
#
# **直接照參考模型那 23 個頂點做。** 玻璃 mesh（`F6F_Cockpit`）很小，整份
# 頂點列得完，所以不必猜：
#
#   Zb 0.287  x0.000 y1.083     Zb 0.822  x0.455 y0.807
#   Zb 0.315  x0.370 y0.982     Zb 1.075  x0.000 y1.511 / x0.187 y1.418
#   Zb 0.491  x0.438 y0.870     Zb 1.132  x0.422 y0.814
#   Zb 0.603  x0.000 y1.423     Zb 1.443  x0.389 y0.821
#   Zb 0.630  x0.187 y1.330     Zb 1.452  x0.000 y1.445 / x0.187 y1.352
#   Zb 0.787  x0.000 y1.500 / x0.187 y1.406
#
# 【後端是一片垂直的框】最後五個頂點全部落在 Zb 1.443…1.452，散佈只有
# 0.009 m —— 由艙緣 0.821 一路到罩頂 1.445 都是同一個 z。第一版把它延伸到
# Zb 1.82 做了個漸收整流，那是憑印象補的（技能坑 22：沒進過量測表的前提，
# 不會被任何一輪修正檢查到）。前端同理：0.287…0.315，也是一片陡框。
#
# 【剖面有三層，不是圓頂】中線、`|x| = 0.187` 的肩、再陡降到艙緣。肩比中線
# 低 **0.093**，而且四個站位（0.630／0.787／1.075／1.452）**全部**是這個值
# —— 那是有骨架的溫室罩：頂上一片微拱的窄板，兩側各一片陡玻璃。
#
# 【艙緣是水平的】量到的五站是 0.982 / 0.870 / 0.807 / 0.814 / 0.821 ——
# 後三站已經平了（散佈 0.014），前兩站那個下降是參考模型把風擋前框的**下角**
# 一起算進來了，不是軌本身。真機那條軌是水平的，取後段的 0.812。
#
# 【而且它本來就埋在機身裡】Zb 1.13 的艙緣在 |x| 0.422，而機身在 y = 0.814
# 的半寬是 0.554 —— 玻璃比機身窄。所以側視看到的「玻璃下緣」是**玻璃與機身
# 的交線**，不是玻璃自己的邊。切刀因此直接用玻璃本身往下封成實體，交線就
# 自動是對的（見 build_cutter）。
#
#          Zb    艙緣x  艙緣y   肩y     罩頂y
SILL_Y = 0.812                             # 水平的艙緣
CANOPY = [
    (0.300, 0.370, SILL_Y, 1.040, 1.083),  # 風擋前框（垂直面，會封起來）
    (0.490, 0.438, SILL_Y, 1.290, 1.383),
    (0.660, 0.450, SILL_Y, 1.360, 1.453),
    (0.822, 0.455, SILL_Y, 1.406, 1.499),  # 最寬
    (1.075, 0.430, SILL_Y, 1.418, 1.511),  # 最高
    (1.443, 0.389, SILL_Y, 1.352, 1.445),  # 後框（垂直面，會封起來）
]
SHOULDER_X = 0.187          # 肩的半寬；前端剖面比它窄時按艙緣等比收

# 切刀只在這個 z 範圍內挖 —— 前後兩端的罩子是坐在實心機背上的整流
CUT_Z0, CUT_Z1 = 0.34, 1.40
FLOOR_Y = -0.28        # 座艙地板（機體 Y）

# ── 機背整流罩（turtledeck）────────────────────────────────────────
#
# 【機身在座艙後方是**兩個體**疊起來的】技能坑 50 的判準：挑一條離軸但仍在
# 半寬之內的 X 帶掃整條機身，它整條大致不變而中線在變 → 中線量到的不是機身。
# 實測 Zb 1.60：
#
#   x0.00  x0.20  x0.35  x0.50  x0.62
#   1.407  1.287  0.899  0.666  0.438
#
# 由 x 0.20 到 0.35 一步掉 0.39 —— 那是一道牆。底下是一根較細的機身，上面
# 疊一條半寬約 0.40 的窄整流。
#
# 【後果】第一版把整條中線當成機身的背線，於是機身在座艙後方變成一塊又高
# 又寬的板，把座艙罩的後下半**埋掉**了 —— 側視看到的那條 45° 斜線不是玻璃
# 的後框（後框是垂直的，量到散佈 0.0000），是玻璃與這塊板的交線。
#
# 本體的中線頂由「離軸 0.72a 的高度 + 該站的超橢圓」反解，差距：
# Zb 0.82 −0.105、1.42 −0.360、1.61 −0.408（最大）、2.4…5.1 約 −0.30。
#
#           Zb     半寬   整流頂
TURTLEDECK = [
    # 【這張表是量出來的，不是外推的】做法：中線正上方射線給整流頂，再由
    #  離軸的一排射線減掉本體超橢圓，殘差降到 5% 以下的那個 x 就是整流的
    #  半寬。Zb 1.50…5.00 每 0.10 一站，全部量得到。
    #
    #  座艙那一段（Zb < 1.44）量到的是罩子，本體被切掉了，所以那幾列只要
    #  平順地接上 —— **關鍵是 Zb 1.443 這一列**：座艙罩後框的頂是 1.445，
    #  而參考的整流在 1.50 是 1.433、1.60 是 1.407（斜率 −0.26/m），往前推
    #  到 1.443 正好是 1.448。上一版這裡只有 1.288，所以玻璃後框整片凸出
    #  機背 0.16 m，看起來就是沒接好。
    (0.500, 0.360, 1.106),
    (0.800, 0.380, 1.230),
    (1.100, 0.390, 1.350),
    (1.443, 0.390, 1.455),   # ← 與座艙罩後框頂（1.445）齊平，寧可略埋
    (1.500, 0.390, 1.443),
    (1.600, 0.380, 1.407),
    (1.800, 0.370, 1.356),
    (2.000, 0.370, 1.305),
    (2.200, 0.360, 1.253),
    (2.400, 0.360, 1.202),
    (2.600, 0.350, 1.155),
    (2.800, 0.330, 1.110),
    (3.000, 0.320, 1.064),
    (3.200, 0.300, 1.019),
    (3.400, 0.290, 0.974),
    (3.600, 0.270, 0.928),
    (3.800, 0.260, 0.883),
    (4.000, 0.250, 0.837),
    (4.200, 0.230, 0.792),
    (4.400, 0.220, 0.747),
    (4.600, 0.200, 0.701),
    (4.800, 0.190, 0.656),
    (5.000, 0.170, 0.610),
    # ── 由此往後量不到（正上方打到的是垂尾，坑 15）──────────────
    #  高度收得比寬度快，讓背脊在尾錐化掉；那一段本來就由垂尾接手。上一版
    #  在這裡「寬度收窄、高度照舊」，做出 0.24 高 0.085 寬的刀刃，中線那條
    #  邊的二面角衝到 148°。
    (5.300, 0.170, 0.504),
    (5.600, 0.155, 0.369),
    (5.900, 0.140, 0.232),
    (6.200, 0.120, 0.094),
    (6.500, 0.100, -0.027),
    (6.800, 0.080, -0.130),
]

# 由中線往外的隆起形狀。u = x / 半寬，u = 1 處值與斜率都是 0，所以整流與機身
# 本體是**相切**接上去的，不會有摺線。指數愈大頂愈飽滿、肩愈陡。
DECK_FALLOFF = 1.25


def _deck_raw(zb):
    """
    在原始的 TURTLEDECK 表上線性內插 (半寬, 整流頂)。**表外回 None** ——
    不能回 (0, 0)：那是「整流頂 = 0」，在尾錐 back 已經是負的地方
    `dh = top − back` 會變成正的而且愈往後愈大，機尾因此長出一根 0.25 高、
    0.01 寬的刺（中線二面角 157°）。
    """
    if zb <= TURTLEDECK[0][0] or zb >= TURTLEDECK[-1][0]:
        return None
    for r0, r1 in zip(TURTLEDECK, TURTLEDECK[1:]):
        if zb <= r1[0]:
            t = (zb - r0[0]) / (r1[0] - r0[0])
            return (r0[1] + (r1[1] - r0[1]) * t,
                    r0[2] + (r1[2] - r0[2]) * t)
    return None


def attach_deck(rows, passes=2, lam=0.35):
    """
    把機背整流併進機身的錨點表，變成第 5、6 欄（半寬、**高出背線多少**）。

    【為什麼不再是獨立物件】上一版把整流做成一條疊在機身上的窄脊，兩側各留
    一道硬摺線，前端還多一片垂直的封口板 —— 側視就是座艙後方那一階。實際上
    它是同一張蒙皮上的隆起，不是另一個體；併進剖面之後整條機身是一次 loft
    出來的連續曲面，摺線與封口板同時消失。

    坑 50 量到的「牆」（Zb 1.60 由 x 0.20 到 0.35 掉 0.39）仍然在 —— 那是
    隆起的肩，由 DECK_FALLOFF 決定陡度，不是靠兩個體疊出來的。

    高度存的是**相對背線**的差，這樣它跟著平滑過的 back 走，不會在整流的頭
    尾兩端把背線頂出一個台階。
    """
    out = []
    for r in rows:
        d = _deck_raw(r[0])
        out.append(tuple(r) + ((d[0], max(0.0, d[1] - r[2])) if d else (0.0, 0.0)))
    # 原始表的站位比 HULL 疏，線性內插會留下摺痕；只對這兩欄再平滑幾趟
    for _ in range(passes):
        src = [list(r) for r in out]
        for i in range(1, len(out) - 1):
            p_, c_, q_ = src[i - 1], src[i], src[i + 1]
            t = (c_[0] - p_[0]) / (q_[0] - p_[0])
            c_ = list(out[i])
            for k in (5, 6):
                lin = p_[k] + (q_[k] - p_[k]) * t
                c_[k] += lam * (lin - c_[k])
            out[i] = tuple(c_)
    return out


HULL = attach_deck(HULL)

# ── 主翼 ────────────────────────────────────────────────────────────
# 翼面積交叉驗證 31.08 對真機 31.03（+0.15%）
# 【中翼段是平的，上反角從摺翼線才開始】把射線量到的翼面最高點扣掉當站的
# 半厚，得到弦線高度：
#
#   x      1.02   1.90   2.34   3.00   4.10   5.20   5.86
#   弦線 −0.360 −0.340 −0.294 −0.209 −0.070  0.066  0.146
#
# x 1.02→1.90 只升 0.020（1.31°），1.90 之後每公尺升 0.1227（7.0°）—— F6F
# 的中翼段是平的，摺翼線在 x ≈ 2.0。上一版用單一 7.36° 從翼根一路上去，
# 翼尖高度剛好對，**翼根卻低了 0.23 m**。
#
# 【翼尖是最後 3.5% 展長才收的】參考的弦長到 x 6.35 都還有 1.56，然後
#   6.40→1.41  6.45→1.22  6.50→0.80，6.53 收掉。除以名義弦長是
#   0.967 / 0.891 / 0.766 / 0.381，和 √(1−k²) 幾乎重合（坑 18：1.524 是
#   **成品**弦長，名義弦長要往回推）。上一版由 0.90 展長就開始用 sin 收，
#   收得太早又收不完，俯視看翼尖是被切平的。
WING = dict(
    root_chord=3.235, tip_chord=1.513, half_span=6.53, root_le_z=-0.809,
    sweep=math.radians(5.244), root_y=-0.383,
    dihedral_in=math.radians(1.31), break_x=2.00, dihedral=math.radians(7.10),
    root_tc=0.152, tip_tc=0.101,
    tip_round=0.12, round_from=0.9648, n_in=10, n_tip=6,
)

# ── 水平尾翼 ────────────────────────────────────────────────────────
#
# 【第一版只做了升降舵】節點名 `F6F_Tail_Flap_L/R` 裡的 Flap 是**舵面**；
# 水平**安定面**跟垂直安定面一樣藏在 `Object_28`（機身那一片）裡。第一版
# 照 `Object_32/34` 做，於是翼根弦只有 0.636 —— 真值 1.728，小了 2.7 倍，
# 而且後掠角讀成 0°（升降舵本來就是等弦長的方塊）。
#
# 兩片一起打的量測值：
#
#   X     0.80   1.10   1.40   1.70   2.00   2.30   2.60
#   前緣  5.47   5.56   5.65   5.74   5.83   5.95   6.10
#   後緣  6.86   6.86   6.86   6.83   6.76   6.75   6.73
#   弦    1.390  1.299  1.208  1.090  0.927  0.799  0.629
#
# 前緣斜率 0.350（後掠 19.3°）、後緣 −0.072，外推到中線：前緣 5.19、
# 後緣 6.918、翼根弦 1.728。舵面鉸鏈在 Zb 6.33。
# 水平尾翼：**後緣不後掠**（整片安定面＋升降舵的後緣量到都是 Zb 6.96），
# 前緣 5.180 + 0.311x（17.3°）。弦長因此是 1.780 − 0.311x，到 x 2.87 還有
# 0.887 —— 上一版的 tip_chord 0.520 把它收得太瘦了。
TAIL = dict(
    root_chord=1.780, tip_chord=0.887, half_span=2.87, root_le_z=5.180,
    # 弦線是**平的**：把量到的翼面最高點扣掉當站半厚，x 0.9 得 0.274、
    # x 2.7 得 0.276 —— 沒有上反角，高度 0.275。上一版的 0.235 + 0.7° 讓整片
    # 尾翼低了 0.025 m。
    sweep=math.radians(17.30), dihedral=0.0, root_y=0.275,
    root_tc=0.125, tip_tc=0.115,
    tip_round=0.10, round_from=0.8014, n_in=4, n_tip=4,
)

# ── 垂尾 ────────────────────────────────────────────────────────────
#
# 【用前後緣的錨點表，不用「翼根→翼尖線性 + tip_round」】那組參數做不出
# 這個形狀：真機的前緣往上會**轉成接近垂直**，頂端是個圓角。線性前緣加一個
# 收縮係數只做得出三角形的尖頂。
#
# 量測值（兩片一起打、射線貼中線 x = 0.012）：
#
#   Yb    0.80   0.95   1.10   1.25   1.40   1.55   1.70   1.85   2.00
#   前緣  5.59   5.67   5.74   5.82   5.90   5.97   6.05   6.19   6.36
#   後緣  7.03   7.01   6.99   6.97   6.95   6.93   6.90   6.75   6.55
#
# 【頂端刻意比參考模型飽滿】參考在 Yb 2.00 的弦長只剩 0.19、2.12 剩 0.02
# —— 那是收成一個尖點。真機的垂尾頂是圓的（前緣轉垂直、頂緣接近水平再接
# 方向舵後緣）。技能坑 21：史實與量測衝突時史實優先，量測只拿來定位置。
#
#   Yb −0.30 與 0.40 兩站是往下外推的虛擬翼根 —— 要低於整段機尾的背線，
#   不然垂尾後半會懸空（技能坑 17）。
#         Yb      前緣    後緣
FIN_PROFILE = [
    (-0.300, 5.030, 7.190),
    ( 0.400, 5.390, 7.090),
    ( 1.000, 5.700, 6.990),
    ( 1.400, 5.900, 6.950),
    ( 1.700, 6.050, 6.900),
    ( 1.900, 6.140, 6.840),   # ← 由此往上是圓角
    ( 2.050, 6.240, 6.720),
    ( 2.140, 6.340, 6.580),
    ( 2.167, 6.420, 6.460),
]
FIN_HALF_THICK = 0.070        # 翼根；往上線性收到 0.75 倍

# 螺旋槳（參考模型的 Object_44，225 個頂點，整組量得出來）。
#
# 【槳盤在哪裡】把頂點按 Zb 分箱、每箱取最大半徑：半徑在 Zb −2.55…−2.49
# 這幾箱衝到 1.93，其餘都只有 0.17 以下 —— **槳盤在 Zb −2.52**，厚 0.06。
# 上一版寫 −2.82，整個槳盤往前跑了 0.30 m，等於掛在整流罩尖端外面。
#
# 【整流罩是個鈍頭彈殼，不是錐子】半徑對 Zb：
#
#   Zb   −2.40  −2.48  −2.57  −2.65  −2.83  −2.88  −2.91  −2.93
#   r     0.153  0.170  0.167  0.153  0.127  0.105  0.068  0.008
#
# 最粗 0.170 就在槳盤那一站，然後幾乎持平到 −2.83 才收頭。上一版的
# r=0.22、長 0.40 的直錐兩頭都不對。基準面往後埋到 Zb −2.30（cowl 前緣
# 是 −2.32），免得罩子懸空。
#
# 【半徑照史實】量到 1.93，但 Hamilton Standard 13 ft 1 in = 3.987 m，
# 半徑 1.994。參考模型全長也比真機短 1.1%（坑 21：史實優先）。
PROP = dict(radius=1.995, blades=3, z=-2.52, axis_y=0.038,
            blade_width=0.20, blade_thick=0.05,
            spinner=[(-2.300, 0.160), (-2.560, 0.168), (-2.870, 0.105)],
            spinner_tip=-2.932, spinner_seg=6)

BODY_COLOR = (0.043, 0.075, 0.118, 1.0)     # Glossy Sea Blue
ACCENT_COLOR = (0.030, 0.033, 0.038, 1.0)
# 【玻璃要暗】0.44/0.66/0.76 那種淺藍在算圖上會把底下的座艙腔整個蓋掉
# —— 單獨算一張證實罩子確實是透明的，但它自己 30% 的漫射加高光就已經
# 比暗色內裝亮。真機的座艙罩看進去本來就是暗的。
# 座艙玻璃 —— **照 P-51D 的做法**（`assembly.ts` 的 `glass`）：
#
#     color 0x9fd4e8   opacity 0.45   roughness 0.2   depthWrite false
#
# 0x9fd4e8 是 sRGB，Blender 的 Base Color 吃線性值，換算後是
# (0.347, 0.659, 0.807)。`depthWrite: false` 在 Blender 對應的就是
# `surface_render_method = 'BLENDED'`（混合層不寫深度）。
GLASS_COLOR = (0.347, 0.659, 0.807, 1.0)
GLASS_OPACITY = 0.45          # 與 three.js 的 opacity 同義；Mix 的 Fac = 1 − 它
GLASS_ROUGHNESS = 0.20



# 翼面的弦向站位與半厚係數。最大厚度在 30% 弦長。
CHORD_U = [0.0, 0.08, 0.30, 0.60, 0.85, 1.0]
CHORD_T = [0.02, 0.72, 1.00, 0.78, 0.42, 0.02]


# ═════════════════════════════════════════════════════════════════════
# Blender 端的小工具
# ═════════════════════════════════════════════════════════════════════
def to_bl(p):
    """機體 (x, y, z) → Blender (x, −z, y)。"""
    return Vector((p[0], -p[2], p[1]))


def new_object(name, bm, coll, mat):
    """
    bmesh → 物件。法線一律讓 bmesh 重算（不要自己推纏繞方向）。

    【中線的 x 要捏成精確的 0】超橢圓在 ±90° 算出來的 x 是 `cos(π/2)` 的
    浮點殘值再取 0.917 次方，約 1e-15 —— 不是 0。Mirror 的 merge 因此**沒有
    焊到**：實測機身沿全長每 0.5 m 留下 10 條開放邊界（上下兩條中線縫）。
    平面著色下看不出來（兩片面還是貼齊的），但 Boolean 與 Solidify 都會壞。
    """
    for v in bm.verts:
        if abs(v.co.x) < 1e-6:
            v.co.x = 0.0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.validate()
    for poly in me.polygons:
        poly.use_smooth = False          # 平面著色
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    coll.objects.link(ob)
    return ob


def add_mirror(ob, clip=True, merge=0.002):
    """左右對稱交給修改器 —— 只建一半、改一邊兩邊動。"""
    m = ob.modifiers.new('Mirror', 'MIRROR')
    m.use_axis[0] = True
    m.use_clip = clip
    m.use_mirror_merge = True
    m.merge_threshold = merge
    return m


def loft(bm, rings, close_ends=True):
    """
    用 `bmesh.ops.bridge_loops` 把一串剖面串成面。

    【為什麼不自己算索引】第一版是 `faces.append([i*n+k, i*n+k2, ...])`，
    而那個順序推錯了方向 —— 機身與垂尾的帶符號體積是 −13.0 與 −0.246，
    算圖上「看穿」機身。bridge_edge_loops 不必推，recalc_face_normals
    再統一朝外。

    `rings` 是一串點列（機體座標）。回傳每一圈的頂點串。
    """
    loops = []
    for ring in rings:
        vs = [bm.verts.new(to_bl(p)) for p in ring]
        es = []
        for i in range(len(vs) - 1):
            es.append(bm.edges.new((vs[i], vs[i + 1])))
        if close_ends and len(vs) > 2:
            es.append(bm.edges.new((vs[-1], vs[0])))
        loops.append((vs, es))
    for i in range(len(loops) - 1):
        bmesh.ops.bridge_loops(bm, edges=loops[i][1] + loops[i + 1][1])
    return loops


def cap(bm, verts):
    """把一圈頂點封成一個 n-gon。"""
    try:
        bm.faces.new(verts)
    except ValueError:
        pass


def superellipse_half(a, back, belly, cy, dw=0.0, dh=0.0, pts=RING_PTS):
    """
    半剖面（x ≥ 0），第一點正上方、最後一點正下方。

    `dw` / `dh` 是機背整流的半寬與高度：在 |x| < dw 的範圍內把背面往上抬
    `dh · (1 − u²)^DECK_FALLOFF`，u = x / dw。u = 1 時值與斜率都是 0，接回
    本體是相切的。
    """
    out = []
    b_up, b_dn = back - cy, cy - belly
    for i in range(pts):
        t = math.pi / 2 - (i / (pts - 1)) ** RING_WARP * math.pi
        b = b_up if t >= 0 else b_dn
        c, s = math.cos(t), math.sin(t)
        x = a * abs(c) ** (2 / N_EXP)
        y = cy + math.copysign(b * abs(s) ** (2 / N_EXP), s)
        if dh > 1e-6 and t > 0.0 and x < dw:
            y += dh * (1.0 - (x / dw) ** 2) ** DECK_FALLOFF
        out.append((x, y))
    return out


def catmull_rom(rows, count):
    """C¹ 重新取樣。線性內插會在每個原始站位留下摺痕，加密反而更明顯。"""
    def sample(i, t, k):
        p0 = rows[max(i - 1, 0)][k]
        p1 = rows[i][k]
        p2 = rows[min(i + 1, len(rows) - 1)][k]
        p3 = rows[min(i + 2, len(rows) - 1)][k]
        return 0.5 * (2 * p1 + (-p0 + p2) * t
                      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                      + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    out, span = [], len(rows) - 1
    for j in range(count):
        u = j * span / (count - 1)
        i = min(int(u), span - 1)
        out.append(tuple(sample(i, u - i, k) for k in range(len(rows[0]))))
    return out


def _lerp_canopy(zb, col):
    """在 CANOPY 表上依 z 線性內插第 `col` 欄；範圍外取端點。"""
    if zb <= CANOPY[0][0]:
        return CANOPY[0][col]
    for r0, r1 in zip(CANOPY, CANOPY[1:]):
        if zb <= r1[0]:
            t = (zb - r0[0]) / (r1[0] - r0[0])
            return r0[col] + (r1[col] - r0[col]) * t
    return CANOPY[-1][col]


def halfwidth_at(zb):
    """玻璃在艙緣的半寬 —— 機身開口的寬度由它決定。"""
    return _lerp_canopy(zb, 1)


def sill_at(zb):
    """玻璃底緣（艙緣）的高度。"""
    return _lerp_canopy(zb, 2)


# ═════════════════════════════════════════════════════════════════════
# 零件
# ═════════════════════════════════════════════════════════════════════
def build_fuselage(coll, mat):
    """機身：只建 x ≥ 0 的一半，左右交給 Mirror。"""
    bm = bmesh.new()
    rings = []
    for zb, a, back, belly, cy, dw, dh in catmull_rom(HULL, STATIONS):
        rings.append([(x, y, zb)
                      for x, y in superellipse_half(a, back, belly, cy, dw, dh)])
    # 【close_ends 必須是 False】半剖面若封成閉迴圈，bridge_loops 會在
    # x = 0 平面多鋪一整片內壁；鏡射之後兩片重疊，中線每條邊掛 4 個面。
    # 實測：機身沿全長 200 條非流形邊，而且平面著色下完全看不出來。
    loops = loft(bm, rings, close_ends=False)
    cap(bm, loops[0][0])
    cap(bm, list(reversed(loops[-1][0])))
    ob = new_object('F6F_Fuselage', bm, coll, mat)
    add_mirror(ob)
    return ob


def build_canopy(coll, mat):
    """
    座艙玻璃 —— **先畫這個**，機身的洞由它決定。

    剖面照量測值分三層：中線、`|x| = 0.187` 的肩、艙緣。只建 x ≥ 0 的一半，
    Mirror 合起來。**前後兩端各封一片垂直的框** —— 那是量到的，不是為了
    補洞：後端五個頂點全部落在 Zb 1.443…1.452。
    """
    bm = bmesh.new()
    rings = []
    for zb, sx, sy, shy, ry in catmull_rom(CANOPY, 8):
        shx = min(SHOULDER_X, sx * 0.45)
        rings.append([(0.0, ry, zb), (shx, shy, zb), (sx, sy, zb)])
    loops = loft(bm, rings, close_ends=False)
    # 前框與後框：半剖面加上中線那一段，鏡射後就是一整片垂直的框
    cap(bm, loops[0][0])
    cap(bm, list(reversed(loops[-1][0])))
    ob = new_object('F6F_Canopy', bm, coll, mat)
    add_mirror(ob, clip=True)
    return ob


def build_cutter(coll, mat):
    """
    座艙的 Boolean 切刀 —— **就是玻璃本身往下封成的實體**。

    第一版的切刀是自己另外訂的方管（艙緣、腰身、往上開），等於玻璃與洞各訂
    一次形狀，兩邊要對得上只能靠運氣。這一版直接拿玻璃的剖面往下延伸到座艙
    地板再封起來：機身減掉它之後，開口的邊界就是**玻璃與機身的交線**，恆等
    成立，不需要任何對齊。

    這正是專案負責人講的「先把玻璃定下來，再讓機身去貼合玻璃」（技能坑 57）。

    切出來的面用暗色 —— 由 Boolean 的 `material_mode = 'TRANSFER'` 帶進去。
    """
    # 【取樣數必須和玻璃一樣】玻璃用 8 站、切刀用 10 站的時候，兩邊是同一條
    # 曲線的**兩種折線近似**；切刀的弦在某些區段跑到玻璃的弦外面，機身就被
    # 多切掉一條，看起來是玻璃後緣旁邊有一道黑縫。
    #
    # 【再往內縮一點】兩者完全重合會沿著整條交線 z-fighting。切刀水平縮 3%、
    # 罩線壓低 12 mm，開口就嚴格小於玻璃，玻璃壓在蒙皮上（真機也是這樣裝的）。
    INSET_X, INSET_Y = 0.97, 0.012
    bm = bmesh.new()
    rings = []
    for zb, sx, sy, shy, ry in catmull_rom(CANOPY, 8):
        shx = min(SHOULDER_X, sx * 0.45)
        sx, shx = sx * INSET_X, shx * INSET_X
        sy, shy, ry = sy - INSET_Y, shy - INSET_Y, ry - INSET_Y
        # 罩子的半剖面（頂 → 肩 → 艙緣），再往下接到座艙地板並封回中線
        half = [(0.0, ry), (shx, shy), (sx, sy), (sx * 0.90, FLOOR_Y), (0.0, FLOOR_Y)]
        ring = half + [(-x, y) for x, y in reversed(half[1:-1])]
        rings.append([(x, y, zb) for x, y in ring])
    loops = loft(bm, rings, close_ends=True)
    cap(bm, loops[0][0])
    cap(bm, list(reversed(loops[-1][0])))
    # 【切刀不鏡射】Boolean 的刀必須是乾淨的封閉實體
    ob = new_object('F6F_CockpitCutter', bm, coll, mat)
    ob.display_type = 'WIRE'
    ob.hide_render = True
    return ob


def panel_stations(p):
    """
    展向站位 —— **不等分**。翼尖圓化只發生在最後 3.5% 展長，等分的 21 站在
    那一段連一站都排不進去，圓角就整個消失（俯視看翼尖被切平）。另外在上反
    角的折點多插一站，讓那道摺線落在量到的位置。
    """
    rf = p.get('round_from', 1.0)
    n_in, n_tip = p.get('n_in', 10), p.get('n_tip', 6)
    us = [i * rf / n_in for i in range(n_in + 1)]
    if p.get('break_x'):
        us.append(p['break_x'] / p['half_span'])
    us += [rf + (1.0 - rf) * (j + 1) / n_tip for j in range(n_tip)]
    return sorted(set(round(u, 6) for u in us))


def panel_y(p, x):
    """弦線高度。有 break_x 的話，折點之內用 dihedral_in，之外用 dihedral。"""
    bx = p.get('break_x', 0.0)
    d_in = p.get('dihedral_in', p['dihedral'])
    if x <= bx:
        return p['root_y'] + math.tan(d_in) * x
    return (p['root_y'] + math.tan(d_in) * bx
            + math.tan(p['dihedral']) * (x - bx))


def build_panel(name, p, coll, mat, mirror_merge=True):
    """翼面：只建右半，Mirror 合起來。翼根不封口，靠 Mirror 的 merge 焊住。"""
    bm = bmesh.new()
    rings = []
    rf = p.get('round_from', 1.0)
    for u in panel_stations(p):
        shrink = 1.0
        if p.get('tip_round') is not None and u > rf:
            k = (u - rf) / (1.0 - rf)
            tr = p['tip_round']
            # 橢圓收尾：k=0 時是 1、k=1 時是 tr，中段和量到的 0.967/0.891/
            # 0.766/0.381 幾乎重合。sin 收尾在前半太陡、後半收不完。
            shrink = tr + (1.0 - tr) * math.sqrt(max(0.0, 1.0 - k * k))
        x = p['half_span'] * u
        nom = p['root_chord'] + (p['tip_chord'] - p['root_chord']) * u
        chord = nom * shrink
        tc = p['root_tc'] + (p['tip_tc'] - p['root_tc']) * u
        le = p['root_le_z'] + math.tan(p['sweep']) * x + (nom - chord) * 0.25
        y = panel_y(p, x)
        ring = [(x, y + chord * tc * ct / 2, le + chord * cu)
                for cu, ct in zip(CHORD_U, CHORD_T)]
        ring += [(x, y - chord * tc * ct / 2, le + chord * cu)
                 for cu, ct in zip(reversed(CHORD_U[1:-1]), reversed(CHORD_T[1:-1]))]
        rings.append(ring)
    loops = loft(bm, rings, close_ends=True)
    cap(bm, list(reversed(loops[-1][0])))          # 只封翼尖
    ob = new_object(name, bm, coll, mat)
    add_mirror(ob, clip=False, merge=0.02 if mirror_merge else 0.0)
    return ob


def build_fin(coll, mat):
    """垂尾：由前後緣錨點表取樣，只建 x ≥ 0 的一半，Mirror 合起來。"""
    bm = bmesh.new()
    rings = []
    prof = catmull_rom(FIN_PROFILE, 9)
    for y, le, te in prof:
        chord = te - le
        u = (y - FIN_PROFILE[0][0]) / (FIN_PROFILE[-1][0] - FIN_PROFILE[0][0])
        th = FIN_HALF_THICK * (1.0 - 0.25 * u)
        rings.append([(th * ct, y, le + chord * cu)
                      for cu, ct in zip(CHORD_U, CHORD_T)])
    loops = loft(bm, rings, close_ends=False)
    cap(bm, loops[0][0])
    cap(bm, list(reversed(loops[-1][0])))
    ob = new_object('F6F_Fin', bm, coll, mat)
    # 門檻要大於前後緣的 2 × 0.0014（翼型首尾點的半厚不是 0）
    add_mirror(ob, clip=True, merge=0.01)
    return ob


def build_spinner(coll, mat):
    """整流罩：三圈 + 一個尖點的彈殼，不是直錐（見 PROP 的量測表）。"""
    p, seg = PROP, PROP['spinner_seg']
    bm = bmesh.new()
    cy = p['axis_y']
    rings = []
    for zb, r in p['spinner']:
        rings.append([(r * math.cos(2 * math.pi * i / seg),
                       cy + r * math.sin(2 * math.pi * i / seg), zb)
                      for i in range(seg)])
    loops = loft(bm, rings, close_ends=True)
    cap(bm, loops[0][0])
    apex = bm.verts.new(to_bl((0.0, cy, p['spinner_tip'])))
    last = loops[-1][0]
    for i in range(seg):
        bm.faces.new((last[i], last[(i + 1) % seg], apex))
    return new_object('F6F_Spinner', bm, coll, mat)


def build_prop(coll, mat):
    """槳葉：照 P-51D 的做法，一葉一個矩形盒，繞軸排開。"""
    p = PROP
    bm = bmesh.new()
    root = p['spinner'][0][1] * 0.8
    length = p['radius'] - root
    for b in range(p['blades']):
        sub = bmesh.new()
        bmesh.ops.create_cube(sub, size=1.0)
        bmesh.ops.scale(sub, verts=sub.verts,
                        vec=Vector((p['blade_width'], p['blade_thick'], length)))
        bmesh.ops.translate(sub, verts=sub.verts, vec=Vector((0.0, 0.0, root + length / 2)))
        # 【只轉一次】槳葉沿 Blender +Z 建好，繞 **Y**（＝機身軸）排開即可。
        # 第一版最後又繞 X 轉了 90°，整個槳盤因此垂直於機身軸 —— 包圍盒
        # 量到 Zb −3.90…−0.82（槳盤躺在側視平面上），而不是 X/Yb 各 ±2。
        bmesh.ops.rotate(sub, verts=sub.verts,
                         matrix=Matrix.Rotation(b * 2 * math.pi / p['blades'], 3, 'Y'))
        bmesh.ops.translate(sub, verts=sub.verts,
                            vec=to_bl((0.0, p['axis_y'], p['z'])))
        me = bpy.data.meshes.new('tmp')
        sub.to_mesh(me)
        sub.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return new_object('F6F_Prop', bm, coll, mat)


def build_cowl_face(coll, mat):
    """cowl 前端的暗色進氣開口。往前浮 12 mm 避免與機身封口 z-fighting。"""
    z0, a, back, belly, cy = HULL[0][:5]
    bm = bmesh.new()
    half = superellipse_half(a * 0.90, back * 0.90, belly * 0.90, cy)
    ring = half + [(-x, y) for x, y in reversed(half[1:-1])]
    vs = [bm.verts.new(to_bl((x, y, z0 - 0.012))) for x, y in ring]
    bm.faces.new(vs)
    return new_object('F6F_CowlFace', bm, coll, mat)


def make_material(name, color, glass=False):
    """
    不透明件用 Principled 就好；**玻璃另外接一顆 Transparent BSDF**。

    【為什麼不用 Principled 的 Alpha】設了 `surface_render_method = 'BLENDED'`、
    `use_backface_culling = True`、Alpha 一路降到 0.26，EEVEE 算出來仍然是
    完全不透明的。把 Base Color 改成純紅重算一次（技能坑 29 的判定法）確認
    那塊就是玻璃 —— 而且是**飽和的**紅，代表 Alpha 整個被忽略。

    Transparent BSDF + Mix Shader 是 EEVEE 一定會生效的路徑：混合是在著色器
    層做的，不吃材質的 alpha 設定。
    """
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (400, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (0, 0)

    def put(k, v):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = v
    put('Base Color', color)
    put('Roughness', GLASS_ROUGHNESS if glass else 0.62)
    put('Metallic', 0.0 if glass else 0.25)

    if glass:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr.location = (0, -200)
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.location = (200, 0)
        mix.inputs['Fac'].default_value = 1.0 - GLASS_OPACITY
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(bsdf.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])
        # 【這三個旗標缺一不可】只設 `surface_render_method = 'BLENDED'` 沒有用
        # —— 實測把 Mix 的 Fac 拉到 1.0（全透明）罩子照樣是實心的白色。
        # 對照組（把**機身**也接上同一組節點）才證明透明本身是好的，卡點在
        # `use_backface_culling = True` 與 `show_transparent_back = False`：
        # 前者只畫朝外那一面、後者不畫背面，兩者一起讓混色沒有東西可混。
        if hasattr(mat, 'surface_render_method'):
            mat.surface_render_method = 'BLENDED'
        if hasattr(mat, 'blend_method'):
            mat.blend_method = 'BLEND'
        mat.use_backface_culling = False
        mat.show_transparent_back = True
        if hasattr(mat, 'use_transparency_overlap'):
            mat.use_transparency_overlap = True
    else:
        nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    mat.diffuse_color = color
    return mat


# ═════════════════════════════════════════════════════════════════════
def main():
    scene = bpy.context.scene
    old = bpy.data.collections.get('F6F')
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    coll = bpy.data.collections.new('F6F')
    scene.collection.children.link(coll)

    body = make_material('F6F_Body', BODY_COLOR)
    accent = make_material('F6F_Accent', ACCENT_COLOR)
    glass = make_material('F6F_Glass', GLASS_COLOR, glass=True)

    # ── 順序有意義：玻璃先，切刀由玻璃長出來，機身最後減掉切刀 ──
    build_canopy(coll, glass)
    cutter = build_cutter(coll, accent)
    fus = build_fuselage(coll, body)
    # 切出來的面要用暗色 —— 讓 Boolean 自己把切刀的材質帶進去
    fus.data.materials.append(accent)
    boo = fus.modifiers.new('Cockpit', 'BOOLEAN')
    boo.operation = 'DIFFERENCE'
    boo.object = cutter
    boo.solver = 'EXACT'
    if hasattr(boo, 'material_mode'):
        boo.material_mode = 'TRANSFER'

    build_panel('F6F_Wing', WING, coll, body)
    build_panel('F6F_Tailplane', TAIL, coll, body)
    build_fin(coll, body)
    build_cowl_face(coll, accent)
    build_spinner(coll, body)
    build_prop(coll, accent)

    cube = bpy.data.objects.get('Cube')
    if cube:
        cube.hide_set(True)
        cube.hide_render = True

    dg = bpy.context.evaluated_depsgraph_get()
    tris, per = 0, []
    for ob in coll.objects:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = 0 if ob.hide_render else len(me.loop_triangles)
        per.append('%-18s %5d  修改器 %s' % (
            ob.name, n, ','.join(m.type for m in ob.modifiers) or '—'))
        tris += n
        ev.to_mesh_clear()
    result['tris'] = tris
    result['parts'] = per


main()
