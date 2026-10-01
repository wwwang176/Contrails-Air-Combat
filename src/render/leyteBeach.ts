import type { BufferGeometry } from 'three'
import { buildDepot } from './depot'
import { LEYTE_BEACH } from '../world/leyte'

/**
 * 整片灘頭的佈景幾何：木箱堆與停著的車（`render/depot.ts`），擺位在
 * `world/leyte.ts` 的 `LEYTE_BEACH`。**每次建一份新的** —— 呼叫端 dispose 的是
 * 它自己的那份。
 *
 * @param heightAt 地面高度（畫出來的那一份，與撞地同一個高度場）
 */
export function buildLeyteBeach(heightAt: (x: number, z: number) => number): BufferGeometry {
  return buildDepot(LEYTE_BEACH.dumps, LEYTE_BEACH.vehicles, heightAt)
}
