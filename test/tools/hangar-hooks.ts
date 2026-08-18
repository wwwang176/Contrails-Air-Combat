/**
 * 機庫開發用出口的型別宣告，給 `*-ref.measure.ts` 那幾支腳本共用。
 *
 * 【為什麼要抽出來】`declare global { interface Window { … } }` 是**全域**
 * 宣告：兩支腳本各寫一份，就算文字一模一樣，TS 也會報 TS2717——因為兩份
 * 回傳型別各自指到自己檔案裡的 `Probe`，是兩個不同的符號。
 *
 * 每加一台飛機就會再撞一次，所以宣告只留一份，量測腳本 import 型別。
 */

/** `__hangarProbe` 的對齊參數。三個值的量法見 `hangar.ts` 的 `REFS`。 */
export interface Align {
  /** 繞模型自己的 Y 轉正，度。轉完機首要朝 −Z */
  yaw: number
  /** 繞世界 X 轉正，度。在 yaw 之後套 */
  pitch: number
  /** 依**翼展**定的縮放（不是全長，見坑 1） */
  scale: number
}

/** `__hangarProbe` 的回傳：整體包圍盒 + 逐 mesh 一行。 */
export interface Probe {
  tris: number
  meshes: number
  min: number[]
  max: number[]
  size: number[]
  parts: {
    name: string
    /**
     * 原材質的摘要（名字 + 透明 + α + 穿透）。
     *
     * 【為什麼需要它】skill 第 5b 步靠 mesh **名稱**分辨玻璃與蒙皮，但那
     * 招吃的是模型作者有沒有好好命名。B-17G 那台 25 個 mesh 全叫
     * `Object_12`、`Object_14`，材質名字還是 UUID——**只有「透明」這個
     * 旗標是可信的**。
     */
    mat: string
    tris: number
    min: number[]
    max: number[]
    size: number[]
  }[]
}

/** `extent` 切片：每一刀在該平面上的 u／v 幅度。 */
export interface Extent {
  planes: number[]
  uMin: number[]
  uMax: number[]
  vMin: number[]
  vMax: number[]
  count: number[]
}

/** `radial` 切片：每一刀、每一個角度的射線長度（0 = 沒打到）。 */
export interface Radial {
  planes: number[]
  theta: number[]
  r: number[][]
}

declare global {
  interface Window {
    __hangarProbe: (u: string, a?: Align) => Promise<Probe>
    /**
     * 第四個參數切自家模型；**第五個是 mesh 名稱的 RegExp**——分別打蒙皮
     * 與玻璃就能量出哪裡是窗（skill 第 5b 步）。
     */
    __hangarSlice: (
      k: string, a: string, o: Record<string, unknown>, t?: 'mine', only?: string,
    ) => Promise<unknown>
    __hangarSpec: (id: string) => boolean
    __hangarRef: (on: boolean, solid?: boolean) => Promise<boolean>
    __hangarRefPitch: (deg: number | null) => void
    __hangarInfo: () => { metrics: { noseZ: number; noseY: number } } | null
    __hangarShow: (mine: boolean, ref: boolean) => void
    /** 亮／暗兩檔打光。機腹在暗的那一檔幾乎全黑，截圖交出去看不出東西 */
    __hangarLit: (on: boolean) => void
    /** 後三個是看向點；順手把 autoRotate 關掉、model.rotation.y 歸零 */
    __hangarCam: (
      x: number, y: number, z: number, tx?: number, ty?: number, tz?: number,
    ) => void
    __hangarOrtho: (v: string | null) => void
  }
}
