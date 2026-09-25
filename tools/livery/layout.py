# -*- coding: utf-8 -*-
"""
塗裝貼圖的版面：四個正投影視圖（上、下、左、右）拼在一張圖上。

展 UV（`tools/blender/p51d_livery_uv.py`）與畫貼圖（`tools/livery/p51d.py`）共用
這一份 —— 兩邊對不上的話，標誌會畫在空白處而不會報錯。

座標一律是**遊戲的機體座標**：X 翼展（+X 右翼）、Y 上、Z 機尾（機首在 −Z）。

每一個視圖都是「站在那一側看過去」的樣子，畫的人照看到的畫就對：
    上視  機首朝上、右翼在右
    下視  機首朝上、右翼在**左**（從底下往上看）
    左視  機首在左
    右視  機首在右

像素座標的原點在圖的左上角，往右、往下增加。
"""

# 貼圖尺寸，px
WIDTH = 2048
HEIGHT = 1536

# 每公尺幾 px。四個視圖同一個比例，畫標誌時不必各自換算
SCALE = 88.0

# 視圖中心（機體座標）與它在圖上的中心（px）
# 上下視：以 (x, z) 為準，每格 1024×1024，涵蓋翼展 ±5.8 m、機身 z −4.05…7.55
PLAN_CENTER_Z = 1.75
TOP_ORIGIN = (512.0, 512.0)
BOTTOM_ORIGIN = (1536.0, 512.0)
# 左右視：以 (z, y) 為準，每格 1024×512，涵蓋 z 同上、y −2.66…3.16
SIDE_CENTER_Y = 0.25
LEFT_ORIGIN = (512.0, 1280.0)
RIGHT_ORIGIN = (1536.0, 1280.0)


# 平尾在上下視裡另外擺：往前移、左右兩半各往外推，落在主翼後緣與機身之間的空位。
# 留在原處的話，它的下面與尾錐的下面投到同一塊，機腹畫的東西會跟著上平尾
TAILPLANE_SHIFT_X = 0.5
TAILPLANE_SHIFT_Z = -1.85


def top(x, z):
    return (TOP_ORIGIN[0] + x * SCALE, TOP_ORIGIN[1] + (z - PLAN_CENTER_Z) * SCALE)


def bottom(x, z):
    return (BOTTOM_ORIGIN[0] - x * SCALE, BOTTOM_ORIGIN[1] + (z - PLAN_CENTER_Z) * SCALE)


def left(z, y):
    return (LEFT_ORIGIN[0] + (z - PLAN_CENTER_Z) * SCALE, LEFT_ORIGIN[1] - (y - SIDE_CENTER_Y) * SCALE)


def right(z, y):
    return (RIGHT_ORIGIN[0] - (z - PLAN_CENTER_Z) * SCALE, RIGHT_ORIGIN[1] - (y - SIDE_CENTER_Y) * SCALE)


def classify(nx, ny):
    """面的法線 → 歸哪一個視圖。只看 x、y：朝前後的面（槳轂、尾錐末端）歸到
    x、y 裡較大的那一邊，會被拉長，但面積都很小。"""
    if abs(ny) >= abs(nx):
        return 'top' if ny >= 0 else 'bottom'
    return 'right' if nx > 0 else 'left'


def project(view, x, y, z, tail_side=0):
    """機體座標的一點 → 該視圖上的像素座標。

    tail_side：平尾的面傳它在哪一半（−1 左、+1 右，看面中心），其餘傳 0。
    同一個面的頂點要用同一個值，否則跨中線的面會被撕開。"""
    if tail_side and view in ('top', 'bottom'):
        x += tail_side * TAILPLANE_SHIFT_X
        z += TAILPLANE_SHIFT_Z
    if view == 'top':
        return top(x, z)
    if view == 'bottom':
        return bottom(x, z)
    if view == 'left':
        return left(z, y)
    return right(z, y)
