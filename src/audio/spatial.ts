import { AudioListener, Object3D, PositionalAudio, Quaternion, Vector3 } from 'three'

/**
 * # 定位聲音的位置：直接設值，不排漸變
 *
 * three 的 `AudioListener` 與 `PositionalAudio` 每一幀對位置參數排
 * `linearRampToValueAtTime`。Chrome 看到 panner 或 listener 的參數有排程，
 * 就改走「每一個取樣重算方位與距離」的路徑 —— 離線實測 40 條聲道吃掉音訊
 * 執行緒 67%（直接設值 19%、不動 6%），大場面的六十條算不完，瀏覽器塞
 * 靜音補上，聽起來是一陣劈啪，而輸出峰值完全不變。**listener 一有排程，
 * 每一個 panner 都被拖進那條路徑。**
 *
 * 這裡的兩個子類別只在位置真的變了才寫 `.value`，沒動的聲源（爆炸、命中）
 * 完全不碰參數。
 *
 * 【不寫 panner 的朝向】全部聲源都是全向的（沒設錐角），朝向不影響輸出。
 */

const _position = new Vector3()
const _quaternion = new Quaternion()
const _scale = new Vector3()
const _forward = new Vector3()
const _up = new Vector3()

/** 【比 float32】參數存的是單精度，拿 double 直接比永遠不相等，等於每幀照寫 */
export function writeParam(p: { value: number }, v: number): void {
  const f = Math.fround(v)
  if (p.value !== f) p.value = f
}

export class DirectListener extends AudioListener {
  override updateMatrixWorld(force?: boolean): void {
    Object3D.prototype.updateMatrixWorld.call(this, force)
    const l = this.context.listener
    this.matrixWorld.decompose(_position, _quaternion, _scale)
    _forward.set(0, 0, -1).applyQuaternion(_quaternion)
    _up.set(0, 1, 0).applyQuaternion(_quaternion)
    if (l.positionX === undefined) {
      l.setPosition(_position.x, _position.y, _position.z)
      l.setOrientation(_forward.x, _forward.y, _forward.z, _up.x, _up.y, _up.z)
      return
    }
    writeParam(l.positionX, _position.x)
    writeParam(l.positionY, _position.y)
    writeParam(l.positionZ, _position.z)
    writeParam(l.forwardX, _forward.x)
    writeParam(l.forwardY, _forward.y)
    writeParam(l.forwardZ, _forward.z)
    writeParam(l.upX, _up.x)
    writeParam(l.upY, _up.y)
    writeParam(l.upZ, _up.z)
  }
}

export class DirectPositionalAudio extends PositionalAudio {
  /**
   * 把 panner 放到世界座標 (x, y, z)。**開始播之前要叫一次** —— 沒在播的時候
   * `updateMatrixWorld` 不同步，panner 還停在上一個聲音那裡。
   */
  placeAt(x: number, y: number, z: number): void {
    const p = this.panner
    if (p.positionX === undefined) {
      p.setPosition(x, y, z)
      return
    }
    writeParam(p.positionX, x)
    writeParam(p.positionY, y)
    writeParam(p.positionZ, z)
  }

  override updateMatrixWorld(force?: boolean): void {
    Object3D.prototype.updateMatrixWorld.call(this, force)
    if (this.hasPlaybackControl && !this.isPlaying) return
    this.matrixWorld.decompose(_position, _quaternion, _scale)
    this.placeAt(_position.x, _position.y, _position.z)
  }
}
