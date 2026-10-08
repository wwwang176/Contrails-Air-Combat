# 前機槍過熱（PLAN）

SPEC：`docs/superpowers/specs/2026-10-08-gun-overheat-design.md`　分支：`feat/gun-overheat`

每一項先寫測試、驗紅，再實作。`PlayerController.update` 在物理步（240 Hz）裡跑，不配置。

## 任務 1：熱度（`src/control/gunHeat.ts`）

```ts
export const GUN_HEAT_SECONDS = 3      // Battery 沒寫時
export const GUN_HEAT_WARN = 0.6       // 加熱中到這裡變黃
export const GUN_HEAT_CLEAR = 0.2      // 冷卻到這裡才回綠
export const GUN_HEAT_UNLOCK = 0.6     // 過熱冷卻到這裡解除
export const GUN_HEAT_COOL = 0.2       // 每秒
export interface GunHeat { heat: number; warn: boolean; locked: boolean }
export function createGunHeat(): GunHeat
export function resetGunHeat(h: GunHeat): void
export function stepGunHeat(h: GunHeat, firing: boolean, seconds: number, dt: number): void
export type GunHeatLevel = 'cool' | 'warn' | 'hot'
export function gunHeatLevel(h: GunHeat): GunHeatLevel
export function overheatSeconds(b: Pick<Battery, 'overheatSeconds'>): number
/** 空響的間隔：最慢那一挺的射擊間隔的一半；沒有前射武器回 Infinity */
export function dryClickInterval(b: Pick<Battery, 'mounts'>): number
```

- `stepGunHeat`：`firing && !locked` 時加熱，到 1 就 `locked = true`、`warn = true`；否則冷卻；`warn` 在 `heat ≥ WARN` 時設、`heat ≤ CLEAR` 時清；`locked` 在 `heat ≤ UNLOCK` 時清。
- 測試：T 秒剛好過熱（T−一步還沒）；遲滯；解除點；冷卻速率；不低於 0；`seconds` 非正／非有限時當 3。

## 任務 2：各機的 T（`src/weapons/types.ts` 與四機）

- `Battery.overheatSeconds?: number`（註解：玩家前射武器打到過熱的秒數，省略 = 3）。
- `BF109K4_BATTERY` 2、`A6M5_BATTERY`／`KI84_BATTERY`／`YAK1B_BATTERY` 2.5。
- 測試：四機的值；其餘戰鬥機走預設。

## 任務 3：`PlayerController`

- 欄位 `readonly gunHeat = createGunHeat()`、`dryFiring = false`、私有 `heatOwner: Aircraft | null`。
- `update(self, dt, out)`：
  - `self !== heatOwner` → `resetGunHeat`、記下 `self`。
  - `want = input.firing && viewMode !== 'bomb'`；`hasGuns = self.spec.battery.mounts.length > 0`。
  - `out.firing = want && !gunHeat.locked`。
  - `stepGunHeat(gunHeat, out.firing && hasGuns, overheatSeconds(self.spec.battery), dt)`。
  - `dryFiring = want && hasGuns && gunHeat.locked`。
- 方法 `resetGunHeatState()`：歸零、`dryFiring = false`。`resetBattle` 在 `b.playerController instanceof PlayerController` 時呼叫。
- 測試：按住 T 秒後 `firing` 變假、`dryFiring` 變真；放開冷卻到 0.6 以下恢復；沒有前射武器（G4M）不加熱；投彈視角不加熱；換一架飛機歸零；`resetBattle` 歸零（接線護欄）。

## 任務 4：HUD

- `HudFrame`：`gunHeat: GunHeatLevel`（預設 `'cool'`）、`gunHeatBlink: boolean`（預設 true，亮）。
- `battleFlightHud`：deps 加 `playerController: Pick<PlayerController, 'gunHeat'>`。代飛或上帝視角時 `'cool'`；否則 `gunHeatLevel(...)`。`gunHeatBlink = Math.floor(battle.world.time * 2 * GUN_HEAT_BLINK_HZ) % 2 === 0`（物理時間，暫停時不閃）。
- `reticle.ts`：十字的顏色 `cool → primary`、`warn → warn`、`hot → danger`；`hot && !gunHeatBlink` 時十字不畫（命中 X 照畫）。
- 測試：假 canvas 量十字的顏色；`hot` 時亮暗兩幀一畫一不畫；圓形準星的顏色不受影響。

## 任務 5：空響

- 素材 `public/audio/gun-jam-1.mp3`、`manifest.json`（`loop: false`、`makeupDb: 8.0`、`envelopeDb: [0.0]`）、`SINGLE_FILES.gunJam = 'gun-jam-1'`。
- `flightAudio`：建立時多收 `gun: Pick<PlayerController, 'dryFiring'>`。`update` 裡：`flying && gun.dryFiring` 時倒數，到 0 播 `audio.playFile(SINGLE_FILES.gunJam, 'reload', 0, 0, 0, false)`、重設成 `dryClickInterval(me.aircraft.spec.battery)`；否則倒數歸 0（下一次按下立刻響）。`reset` 也歸 0。
- 測試：`dryFiring` 期間依間隔播放；放開就停；再按立刻響；不在飛（上帝視角）不播。素材清單、目錄的既有護欄涵蓋新檔。

## 任務 6：驗收

- 相關測試、`tsc`；合併前整層。
- Playwright：進一場遭遇戰或任務，按住射擊，截黃、紅十字各一張。
