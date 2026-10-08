import { Quaternion, type PerspectiveCamera, type Vector3 } from 'three'
import type { InputState } from '../input/InputState'
import type { AimAssist } from '../input/aimAssist'
import type { Controller } from '../control/Controller'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'
import type { CameraRig } from '../camera/CameraRig'
import { enterGodCamera, type GodCameraState, type GodCameraInput } from '../camera/godCamera'
import { startBlend, type CameraBlend } from '../camera/cameraBlend'
import { deathCamAim, enterDeathCam } from '../camera/deathCam'
import { BOMB_AIM_SCALE, levelAimBasis, slewAimWorld } from '../input/aim'
import { headingFromOrientation } from '../core/attitude'
import { DEG } from '../core/math'
import { resetGEffect } from '../hud/widgets/gEffect'
import { resetDamageMarks, type DamageMark } from '../hud/damageMarks'

interface PlayerControlDependencies {
  input: InputState
  bindings: { clearHolds(): void }
  camera: PerspectiveCamera
  rig: Pick<CameraRig, 'viewBase' | 'snapTo'>
  playerAi: Controller
  /** 玩家的控制器；不在座位上（代飛、上帝視角）的期間由這裡替它的前機槍冷卻 */
  playerController: Controller & { coolWhileAway(seconds: number): void }
  aimAssist: Pick<AimAssist, 'step' | 'reset'>
  visuals: { get(player: Combatant): { readonly position: Vector3 } | undefined }
  godCam: GodCameraState
  godBlend: CameraBlend
  godInput: Pick<GodCameraInput, 'lookX' | 'lookY'>
  damageMarks: DamageMark[]
}

/** 共用的操控只綁一次；戰鬥與玩家在接手之後重新傳入 */
export function createPlayerControl({
  input, bindings, camera, rig, playerAi, playerController, aimAssist,
  visuals, godCam, godBlend, godInput, damageMarks,
}: PlayerControlDependencies) {
  let wasGodView = false
  let wasDying = false
  const BOMB_AIM_BASIS = new Quaternion()

  function stepPlayerControl(
    battle: { readonly takeoverSeat: number; readonly takeoverKiller: number },
    player: Combatant,
    world: Pick<World, 'combatants'>,
    worldSeconds: number,
  ): boolean {
    // 世界固定瞄準點：滑鼠位移繞相機的右／上軸旋轉它。不夾制——相機跟著瞄準點
    // 走，準星恆在畫面正中央，「準星不能離開畫面」那個前提不存在了（見 input/aim.ts）。
    // 右鍵自由視角時 bindings 不累積 aimDelta，所以瞄準點原地不動，飛機繼續
    // 飛向玩家先前指的地方。
    //
    // 【軸取自 rig.viewBase 而不是 camera.quaternion】viewBase 不含自由視角
    // 偏移。轉頭時若拿實際相機姿態，滑鼠的螢幕座標軸會跟著轉頭一起轉。
    //
    // 【AI 接管時瞄準點鎖在機首】相機是跟著瞄準點走的。接管期間滑鼠仍然會
    // 累積位移，若照常套用，相機會被拖離飛機——而這個模式的全部意義就是
    // 「看清楚 AI 在幹嘛」。鎖在機首讓相機自然地跟拍。右鍵自由視角不受影響：
    // 它是 rig 之上的獨立偏移，不經過瞄準點。
    // ── 上帝視角的進出 ────────────────────────────────────
    // 【一定要排在讀 `input.playerAi` 之前】進入的那一幀就要代飛，否則會有
    // 一幀是「鏡頭已經飛走了但飛機沒人在開」
    if (input.godView !== wasGodView) {
      // 【兩個方向都從相機現在的姿態開始過渡】這裡是幀首，相機還停在上一幀
      // 的姿態 —— 那正是玩家眼前的畫面。下面各自算出目的姿態後由 `applyBlend`
      // 拉回起點的比例，所以進去與回來走的是同一條路
      startBlend(godBlend, camera)
      if (input.godView) {
        input.playerAi = true
        // 【用算繪位置而不是物理位置】這裡是幀首，算繪位置是上一幀內插的
        // 結果 —— 那正是玩家最後看到的那個位置
        enterGodCamera(
          godCam,
          visuals.get(player)!.position,
          headingFromOrientation(player.aircraft.state.orientation),
        )
      } else {
        // 【一律關掉代飛】直接對應「取消上帝視角後就回到我自己飛」。副作用
        // 是進入前就開著的 `I` 也會被關掉，刻意不記憶原本的值
        input.playerAi = false
        // 【相機要重新吸附】不吸附的話它會從上帝位置一路彈簧飛回來
        rig.snapTo(input.aimWorld)
      }
      wasGodView = input.godView
    }
    const aiFlying = input.playerAi
    // 【死亡鏡頭】玩家陣亡到接手之間的那 2 秒：位置定在死亡點（殘骸化之後
    // `Visual.position` 就不再更新，而相機讀的正是它），視線平滑轉向擊殺者。
    // 這段期間滑鼠不該做任何事 —— 已經沒有飛機可以操縱了。
    const dying = battle.takeoverSeat >= 0
    // 【死掉的那一刻就把畫面擦乾淨】歸零過載只讓黑視「不再累積」，已經累積的
    // 那一份要 2.4 s 才退得掉（`RECOVERY_TIME`），比死亡鏡頭本身還長。
    if (dying && !wasDying) {
      resetGEffect()
      resetDamageMarks(damageMarks)
      // 視角退回機外、取消右鍵轉頭 —— 死亡鏡頭只在機外、只看擊殺者
      enterDeathCam(input)
    }
    // 輸入層靠它擋掉死亡鏡頭期間的右鍵與 B；接手完成的那一幀自動解除
    input.dead = dying
    wasDying = dying
    if (input.godView) {
      // 【上帝分支排在 `dying` 之前】排在後面的話，陣亡那 2 秒 `lookX/lookY`
      // 不再更新、而下面的清除又被 `if (!input.godView)` 擋住 —— 鏡頭會以
      // 上一幀的位移**等速自轉**兩秒。spec §7.1 說死亡不影響上帝視角，
      // 只有這個順序做得到
      //
      // 【瞄準點鎖在機首】與 `I` 同一個理由：切回來時飛機才不會被一個舊的
      // 瞄準點硬扯過去。滑鼠位移在下面被鏡頭吃掉，不進 `slewAimWorld`
      input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
      input.firing = false
      godInput.lookX = input.aimDeltaX
      godInput.lookY = input.aimDeltaY
    } else if (dying) {
      const killerSeat = battle.takeoverKiller
      deathCamAim(
        input.aimWorld,
        visuals.get(player)!.position,
        // 兇手在這 2 秒裡也可能死掉；那時他的位置停在自己的墜落點，
        // 鏡頭看過去仍然是對的畫面
        killerSeat >= 0 ? world.combatants[killerSeat]!.aircraft.state.position : null,
        worldSeconds,
      )
      input.firing = false
    } else if (aiFlying) {
      input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
      // 左鍵失效：開火完全由 AI 的開火紀律決定
      input.firing = false
    } else if (input.viewMode === 'bomb') {
      // 【投彈模式只能微調】位移乘 `BOMB_AIM_SCALE`，旋轉軸取瞄準方向自己的
      // 水平座標系，不取相機 —— 投彈相機朝下看，拿它的軸滑鼠的語意就變了
      // （見 `levelAimBasis`）。不動滑鼠就是保持航向與姿態
      slewAimWorld(
        input.aimWorld, input.aimDeltaX * BOMB_AIM_SCALE, input.aimDeltaY * BOMB_AIM_SCALE,
        levelAimBasis(input.aimWorld, BOMB_AIM_BASIS), camera.fov * DEG,
      )
    } else {
      slewAimWorld(
        input.aimWorld, input.aimDeltaX, input.aimDeltaY,
        rig.viewBase, camera.fov * DEG,
      )
      // 【輔助排在玩家之後】先吃玩家這一幀的轉動，再拉。轉動量與 `slewAimWorld`
      // 同一個換算（位移 × 半個 FOV）
      const playerTurn = Math.hypot(input.aimDeltaX, input.aimDeltaY) * camera.fov * DEG / 2
      aimAssist.step(input.aimWorld, playerTurn, worldSeconds, player, world.combatants)
    }
    // 【只在一般飛行時吸】其餘分支的瞄準點不歸玩家管，離開時要放掉目標
    if (input.godView || dying || aiFlying || input.viewMode === 'bomb') aimAssist.reset()
    input.aimDeltaX = 0
    input.aimDeltaY = 0
    // 【不在上帝視角時要清掉】留著的話，下次進上帝視角的第一幀會吃到一個
    // 陳年的位移，鏡頭會跳一下
    if (!input.godView) {
      godInput.lookX = 0
      godInput.lookY = 0
    }

    // 【陣亡等待接手的期間不換控制器】那一架已經退場，`World.step` 根本不會
    // 呼叫它的控制器；而交還那一支會把瞄準點拉回機首 —— 死亡鏡頭正在用它。
    if (dying) {
      // 什麼都不做
    } else if (aiFlying && player.controller !== playerAi) {
      player.controller = playerAi
    } else if (!aiFlying && player.controller !== playerController) {
      player.controller = playerController
      // 交還操縱時把瞄準點留在機首，玩家才不會被一個舊的瞄準點硬扯過去
      input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
      // 【跟瞄歷史一起清】瞄準方向剛被一步重設，那一步不是角速度（`resetTrack`）
      player.aircraft.director.resetTrack()
    }
    // 【不在座位上照樣冷卻】代飛時 `World.step` 呼叫的是 `playerAi`，玩家控制器的熱度會凍結；
    // 不在這裡冷卻的話，過熱時按 I、等十秒再接回來仍然是鎖住的，空響也停不下來
    if (player.controller !== playerController) playerController.coolWhileAway(worldSeconds)

    return dying
  }

  /**
   * 退出上帝視角。**重開一場與換場都要呼叫**。
   *
   * 不呼叫的話：上帝視角 → ESC → 回主選單 → 開始戰鬥，新的一場會直接開在
   * 上帝視角，而鏡頭停在舊世界的座標上。與 `input.pointerLockLost = false`
   * 是同一類殘留 —— 這兩個函數都是「換一場」的入口。
   *
   * 【`wasGodView` 也要一起清】只清 `input.godView` 的話邊緣偵測不會觸發，
   * `playerAi` 會留在 true，新的一場開頭是 AI 在飛。
   *
   * 【按鍵狀態也要清】這裡是直接改 `input.godView` 的，繞過了 `G` 的處理器。
   */
  function leaveGodView(): void {
    input.godView = false
    wasGodView = false
    input.playerAi = false
    // 新的一場不該從上一場的鏡頭位置飄過來
    godBlend.active = false
    bindings.clearHolds()
  }

  function resetDeathState(): void {
    wasDying = false
  }

  return { stepPlayerControl, leaveGodView, resetDeathState }
}
