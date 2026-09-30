import type { BufferGeometry } from 'three'
import { buildDepot } from './depot'
import { BUILDING_DEPTH, BUILDING_ROOF, BUILDING_WALL, BUILDING_WIDTH, buildingGeometry, TAR_ROOF } from './floraShapes'
import { CRATE_FIELDS, HUTS, VEHICLES, type Hut } from '../world/asch'

/**
 * # Y-29 的佈景
 *
 * 營房、補給堆、停著的車，合併成一顆網格（`render/depot.ts`），**不是目標、
 * 沒有碰撞**。擺位在 `world/asch.ts`。
 *
 * 【營房是村裡的房子】同一個形狀（`floraShapes.ts` 的 `buildingGeometry`），牆換
 * 成木板色、屋頂是油毛氈，壓低成一層的工寮。
 */

/** 風吹日曬的松木板 */
const WOOD_WALL = 0x76593c
/** 牆加屋頂的總高，m：牆約 2.8、屋頂約 2.2 */
const HUT_HEIGHT = 5
/** 每一棟的深淺抖多少 */
const HUT_TINT = 0.18

/**
 * 整片佈景的幾何。**每次建一份新的** —— 呼叫端 dispose 的是它自己的那份。
 * 車用地面單位的樣板，**樣板要先載**。
 *
 * @param heightAt 地面高度（畫出來的那一份，與撞地同一個高度場）
 */
export function buildAschScenery(heightAt: (x: number, z: number) => number): BufferGeometry {
  const template = buildingGeometry(WOOD_WALL, TAR_ROOF)
  // 【種子是序號】同一張地圖每次都長一樣
  const huts = HUTS.map((h, i) => hutGeometry(
    template, h, heightAt(h.x, h.z), 1 - HUT_TINT / 2 + HUT_TINT * (((i + 1) * 2654435761 >>> 0) / 4294967296),
  ))
  template.dispose()
  return buildDepot(CRATE_FIELDS, VEHICLES, heightAt, huts)
}

/**
 * 一棟營房擺到位：從 `template`（`buildingGeometry`）複製、整棟顏色乘 `tint`、
 * 縮放、轉向、放到高度 `y`。
 *
 * 【屋脊沿樣板的 z】樣板的山牆在 ±x 兩端、屋脊沿 z（`BUILDING_DEPTH` 那一邊），
 * 所以 `length` 縮 z、`width` 縮 x。反過來的話每一棟的屋脊都橫在短邊上
 */
export function hutGeometry(template: BufferGeometry, h: Hut, y: number, tint: number): BufferGeometry {
  const g = template.clone()
  const col = g.getAttribute('color')
  for (let k = 0; k < col.count; k++) {
    col.setXYZ(k, col.getX(k) * tint, col.getY(k) * tint, col.getZ(k) * tint)
  }
  g.scale(h.width / BUILDING_WIDTH, HUT_HEIGHT / (BUILDING_WALL + BUILDING_ROOF), h.length / BUILDING_DEPTH)
  g.rotateY(h.heading)
  g.translate(h.x, y, h.z)
  return g
}
