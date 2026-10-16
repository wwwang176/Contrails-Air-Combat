import type { BufferGeometry } from 'three'
import { buildDepot } from './depot'
import { LEYTE_BEACH, LEYTE_JUNCTIONS } from '../world/leyte'

/**
 * 灘頭與路口據點的佈景幾何：木箱堆與停著的車（`render/depot.ts`），擺位在
 * `world/leyte.ts` 的 `LEYTE_BEACH` 與 `LEYTE_JUNCTIONS`。路口停的車是任務目標，
 * 由地面目標畫，這裡只放木箱堆。**每次建一份新的** —— 呼叫端 dispose 的是
 * 它自己的那份。
 *
 * @param heightAt 地面高度（畫出來的那一份，與撞地同一個高度場）
 */
export function buildLeyteBeach(heightAt: (x: number, z: number) => number): BufferGeometry {
  const dumps = [...LEYTE_BEACH.dumps, ...LEYTE_JUNCTIONS.flatMap((j) => j.dumps)]
  return buildDepot(dumps, LEYTE_BEACH.vehicles, heightAt)
}
