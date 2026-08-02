import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CameraRig, DEFAULT_CAMERA_OPTIONS } from '../../src/camera/CameraRig'
import { DEG } from '../../src/core/math'

const DT = 1 / 60

function makeRig() {
  return { rig: new CameraRig(), cam: new PerspectiveCamera(65, 16 / 9, 1, 60000) }
}

/** 機首上仰 pitchDeg 度的姿態（機體前方為 −Z，繞 +X 轉即抬頭）。 */
function pitched(pitchDeg: number) {
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitchDeg * DEG)
}

describe('CameraRig', () => {
  it('第三人稱相機位於飛機後上方', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    expect(cam.position.z).toBeGreaterThan(pos.z)
    expect(cam.position.y).toBeGreaterThan(pos.y)
  })

  it('彈簧阻尼使相機收斂至目標位置', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    for (let i = 0; i < 240; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const expected = new Vector3(
      0,
      3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight,
      DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(expected)).toBeLessThan(0.5)
  })

  it('等速直線飛行時相機不落後（落後量不得正比於速度）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    // 700 km/h。世界座標彈簧在這裡的穩態誤差是 c·v/k ≈ 103 m，飛機會縮成一個點
    for (let i = 0; i < 240; i++) {
      pos.z -= 195 * DT
      rig.update(cam, pos, q, 195, 'third', 0, 0, DT)
    }
    const ideal = new Vector3(
      pos.x,
      pos.y + DEFAULT_CAMERA_OPTIONS.thirdHeight,
      pos.z + DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(ideal)).toBeLessThan(0.5)
  })

  it('大 G 轉彎時相機落後於機尾方向（速度感來源）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    rig.snapTo(new Quaternion())

    // 以 60°/s 持續偏航，彈簧把相機留在轉彎外側
    let q = new Quaternion()
    for (let i = 1; i <= 120; i++) {
      q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i * DT * 60 * DEG)
      rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    }
    const behind = new Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize()
    const toCam = cam.position.clone().sub(pos).setY(0).normalize()
    expect(toCam.angleTo(behind)).toBeGreaterThan(10 * DEG)

    // 停止轉彎後回到正後方
    for (let i = 0; i < 240; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const settled = cam.position.clone().sub(pos).setY(0).normalize()
    expect(settled.angleTo(behind)).toBeLessThan(1 * DEG)
  })

  it('機首視角的相機貼近飛機', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.update(cam, pos, q, 160, 'first', 0, 0, DT)
    expect(cam.position.distanceTo(pos)).toBeLessThan(3)
  })

  it('機首視角的眼點隨機體姿態轉動（換機種時可改寫）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    rig.options.firstPersonOffset.set(0, 0.78, 0.60)

    // 正飛：眼點在原點上方偏後
    rig.update(cam, pos, new Quaternion(), 160, 'first', 0, 0, DT)
    expect(cam.position.y).toBeCloseTo(3000.78, 6)
    expect(cam.position.z).toBeCloseTo(0.60, 6)

    // 右滾 90°：座位跟著轉到側邊，不會留在機身上方
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -90 * DEG)
    rig.update(cam, pos, rolled, 160, 'first', 0, 0, DT)
    expect(cam.position.x).toBeCloseTo(0.78, 6)
    expect(cam.position.y).toBeCloseTo(3000, 6)
  })

  it('FOV 隨速度上升', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.update(cam, pos, q, 0, 'third', 0, 0, DT)
    const slow = cam.fov
    rig.update(cam, pos, q, 220, 'third', 0, 0, DT)
    expect(cam.fov).toBeGreaterThan(slow)
    expect(cam.fov).toBeLessThanOrEqual(
      DEFAULT_CAMERA_OPTIONS.fovBase + DEFAULT_CAMERA_OPTIONS.fovSpeedGain + 0.01,
    )
  })

  it('自由視角改變相機位置但不改變飛機狀態', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const before = cam.position.clone()
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 90 * DEG, 0, DT)
    expect(cam.position.distanceTo(before)).toBeGreaterThan(5)
    expect(q.equals(new Quaternion())).toBe(true) // 飛機姿態未被觸碰
  })

  it('viewBase 不受自由視角影響（瞄準點的畫面夾制拿它當基準）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const neutral = rig.viewBase.clone()

    // 轉頭 120°：相機真的轉開了，但基準必須原封不動——否則瞄準點會被夾制
    // 拖著跟相機一起走，玩家只是看一眼就把飛機轉向了
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 120 * DEG, 0, DT)
    expect(rig.viewBase.angleTo(neutral)).toBeLessThan(1e-6)
    expect(cam.quaternion.angleTo(neutral)).toBeGreaterThan(60 * DEG)
  })

  it('轉頭跟得上滑鼠：0.1 秒內就轉到位，且不經過機動彈簧', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)

    // 對照組：拖曳沿用回正的時間常數（改掉 lookFollowTime 之前的行為）
    const slowRig = new CameraRig({
      ...DEFAULT_CAMERA_OPTIONS,
      lookFollowTime: DEFAULT_CAMERA_OPTIONS.lookReturnTime,
    })
    const slowCam = new PerspectiveCamera(65, 16 / 9, 1, 60000)
    slowRig.snapTo(q)
    for (let i = 0; i < 120; i++) slowRig.update(slowCam, pos, q, 160, 'third', 0, 0, DT)

    for (let i = 0; i < 6; i++) {
      rig.update(cam, pos, q, 160, 'third', 90 * DEG, 0, DT)
      slowRig.update(slowCam, pos, q, 160, 'third', 90 * DEG, 0, DT)
    }
    // 0.1 秒後：快的走完約 92°%，慢的只有 33%
    const ideal = new Vector3(
      DEFAULT_CAMERA_OPTIONS.thirdDistance,
      3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight,
      0,
    )
    expect(cam.position.distanceTo(ideal)).toBeLessThan(2)
    expect(cam.position.distanceTo(ideal)).toBeLessThan(slowCam.position.distanceTo(ideal) / 3)
  })

  it('自由視角放開後回正', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 120 * DEG, 0, DT)
    for (let i = 0; i < 240; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const expected = new Vector3(
      0, 3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight, DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(expected)).toBeLessThan(1)
  })

  it('setShake 使相機位置產生擾動', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion()
    rig.snapTo(q)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
    const calm = cam.position.clone()
    rig.setShake(1)
    let maxOffset = 0
    for (let i = 0; i < 30; i++) {
      rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
      maxOffset = Math.max(maxOffset, cam.position.distanceTo(calm))
    }
    expect(maxOffset).toBeGreaterThan(0.05)
  })

  it('相機不隨機體側滾（瞄準點的螢幕座標軸才不會跟著轉）', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 60 * DEG)
    rig.snapTo(rolled)
    for (let i = 0; i < 120; i++) rig.update(cam, pos, rolled, 160, 'third', 0, 0, DT)

    const level = new Vector3(
      0, 3000 + DEFAULT_CAMERA_OPTIONS.thirdHeight, DEFAULT_CAMERA_OPTIONS.thirdDistance,
    )
    expect(cam.position.distanceTo(level)).toBeLessThan(0.5)
    expect(cam.up.dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.999)
  })

  it('筋斗翻過天頂時相機連續移動，不會瞬間甩到另一側', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    rig.snapTo(pitched(0))

    // 以 90°/s 從平飛拉到倒飛，逐幀檢查相機的位移與上方向量都不跳變
    let prevPos: Vector3 | null = null
    let prevUp: Vector3 | null = null
    let maxStep = 0
    let maxTurn = 0
    for (let i = 0; i <= 120; i++) {
      const q = pitched(i * 1.5)
      rig.update(cam, pos, q, 160, 'third', 0, 0, DT)
      if (prevPos) maxStep = Math.max(maxStep, cam.position.distanceTo(prevPos))
      if (prevUp) maxTurn = Math.max(maxTurn, prevUp.angleTo(cam.up))
      prevPos = cam.position.clone()
      prevUp = cam.up.clone()
    }
    // 每幀 1.5° 的姿態變化，32 m 臂長換算約 0.84 m；留兩倍餘裕
    expect(maxStep).toBeLessThan(1.7)
    expect(maxTurn).toBeLessThan(10 * DEG)
    expect(Number.isFinite(cam.position.length())).toBe(true)
  })

  it('狀態不產生 NaN', () => {
    const { rig, cam } = makeRig()
    const pos = new Vector3(0, 3000, 0)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 2.1)
    for (let i = 0; i < 300; i++) {
      pos.add(new Vector3(1, -0.2, -3))
      rig.update(cam, pos, q, 200, 'third', 0.5, -0.3, DT)
    }
    expect(Number.isFinite(cam.position.length())).toBe(true)
  })
})
