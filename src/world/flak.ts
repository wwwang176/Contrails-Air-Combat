/**
 * # 高砲彈 —— 近炸引信與黑雲
 *
 * **它不進 `Projectiles`。**
 *
 * 【為什麼另開一個池】`Projectiles` 是 4,000 格，每個物理步對每一發做線段
 * 對 AABB 的判定。近炸引信不需要那個 —— 彈丸飛行途中什麼都不會發生，
 * **只有引爆那一刻算數**。塞進去等於為了一個不做命中判定的東西，付整套命中
 * 判定的錢，而且還要在那條熱路徑上多一個「這一發是不是高砲彈」的分支。
 *
 * 【它也沒有曳光】真實的高射砲彈你看不見，你只看到它炸開。這一點與上面
 * 那個決定互相加強：不進池 ⇒ `render/tracers.ts` 自然畫不到它。
 */

/**
 * 池的容量。
 *
 * 【怎麼算的】洛伊納是最吃緊的一關：48 座陸上高砲 × 30 發/分 = 每秒 24 發，
 * 乘上引信上限 8.2 秒 = 197 發同時在空中。（日 M3 的 6 個 5 吋砲區只要 22。）
 *
 * 【滿了就拒絕發射】與 `Projectiles` 覆寫最舊的相反 —— 見 `spawnFlak`。
 * 所以估太小的症狀是**整場的射速被池上限壓住**，而且不報錯。
 */
export const FLAK_CAPACITY = 512

/**
 * 引信秒數上限。射程 = 初速 450 × 11 ≈ 4,950 m。
 *
 * 【它為什麼是上限而不是射程】與 `PROJECTILE_LIFETIME` 同一個道理：能不能
 * 打到取決於**攔截點**而不是目標當下的距離。解出來的飛行時間超過它就不開火。
 */
export const FLAK_MAX_FUSE = 11

/** 殺傷半徑，m。**起始值，由試飛裁定。** */
export const FLAK_RADIUS = 50

/**
 * 爆心的傷害。**這是進 `World.applyDamage` 的輸入值，不是實扣的血。**
 *
 * 【實扣的不等於它】`applyDamage` 還會除以機種的 `protection.fuselage`：
 * F6F-5 是 1.15、P-51D 是 0.80，同一朵雲對它們分別扣 174 與 250。
 * `japan-m3` 的 G4M 剛好是 1.00，所以表上的數字看起來成立 —— **那是巧合。**
 * 防護力照走（機身裝甲厚的飛機比較耐炸本來就該成立），要記住的是調表時
 * 看的是輸入值。
 */
export const FLAK_DAMAGE = 200

/**
 * 一朵雲的鏡頭震動當量尺度。**5 吋艦砲那一發的值**，與
 * `camera/cameraShake.ts` 的 `FLAK_SHAKE` 同值（護欄釘住）。
 *
 * 【為什麼住在這裡而不是相機層】它是彈藥的屬性，逐發跟著砲彈走；相機層
 * 只是那個數字的消費者。
 */
export const FLAK_SHAKE = 0.25

/**
 * 黑雲的散佈半徑，m。**5 吋艦砲那一發的值。**
 *
 * 【雲比殺傷範圍小】看得見的那一團不等於危險範圍 —— 陸上的 88 殺傷 75 m，
 * 而雲仍然是這個大小。兩者是獨立的一格，不是同一個數字的兩種用法。
 */
export const FLAK_SMOKE = 16.7

/** 空中閃光與火球的線性尺度。1 = `render/blast.ts` 的 `FLAK_BLAST` 原配方 */
export const FLAK_BLAST_SCALE = 1

/** 事件緩衝的預設容量。一步之內同時引爆超過這個數就丟棄並記數。 */
export const BURST_CAPACITY = 64

/**
 * 空中的高砲彈。**SoA，永遠不配置。**
 *
 * `team` 是 −1 代表空槽（與 `Projectiles` 用 `owner === -1` 同一個手法，
 * 但這裡沒有 owner 這一欄 —— 高砲不記分）。
 */
export interface FlakShells {
  readonly capacity: number
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vz: Float32Array
  /** 還剩幾秒引爆。 */
  readonly fuse: Float32Array
  /** 發射方：0 = blue、1 = red、**−1 = 空槽**。 */
  readonly team: Int8Array
  /**
   * 殺傷半徑與爆心傷害，**逐發帶著走**。
   *
   * 【為什麼不是模組常數】5 吋艦砲與陸上的 88 mm 是兩種砲：一個守航母、
   * 一個守油廠，強度要分開調。做成常數的話調洛伊納會連帶動到日 M3 的
   * 第 58 特遣艦隊 —— 而那一關的平衡是另外試飛出來的。
   */
  readonly radius: Float32Array
  readonly damage: Float32Array
  /**
   * 表現的三個尺度，**每一個都是規格表上獨立的一格**，不從殺傷半徑推導。
   *
   * ```
   *   smoke  黑雲的散佈半徑，m（`render/flakBursts.ts`）
   *   blast  空中閃光與火球的線性尺度，1 = `FLAK_BLAST` 原配方
   *   shake  鏡頭震動的當量尺度（`camera/cameraShake.ts` 的 `addShake`）
   * ```
   *
   * 【為什麼不從 `radius` 算】它們是手感。雲小一號、搖一樣重、閃光大一點都
   * 是合法的選擇 —— 綁成公式之後，調任何一個都會動到另外兩個。
   */
  readonly smoke: Float32Array
  readonly blast: Float32Array
  readonly shake: Float32Array
  live: number
}

/**
 * 這一個物理步的引爆事件。**呼叫端負責排空**（與 `world/events.ts` 的
 * `ImpactEvents` 同一個約定）。
 *
 * 兩個消費者：`World` 拿它算範圍傷害，渲染層拿它噴黑雲。
 */
export interface BurstEvents {
  readonly capacity: number
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly team: Int8Array
  /**
   * 那一發的殺傷半徑與爆心傷害（`World` 算範圍傷害用）、以及表現的三個
   * 尺度（黑雲、閃光、震動）。四個消費者各讀各的那一格 —— 見 `FlakShells`。
   */
  readonly radius: Float32Array
  readonly damage: Float32Array
  readonly smoke: Float32Array
  readonly blast: Float32Array
  readonly shake: Float32Array
  count: number
  /**
   * 因為滿了而丟掉幾筆。
   *
   * 【為什麼要記】headless 測試不排空，於是緩衝會填滿並開始丟棄 —— 那沒有
   * 問題，但**有排空的測試需要一個東西可以斷言**，否則「掉了一朵雲」是完全
   * 無聲的。
   */
  dropped: number
}

export function createFlak(capacity: number = FLAK_CAPACITY): FlakShells {
  const f = (): Float32Array => new Float32Array(capacity)
  return {
    capacity,
    x: f(), y: f(), z: f(),
    vx: f(), vy: f(), vz: f(),
    fuse: f(),
    team: new Int8Array(capacity).fill(-1),
    radius: f(), damage: f(), smoke: f(), blast: f(), shake: f(),
    live: 0,
  }
}

export function createBursts(capacity: number = BURST_CAPACITY): BurstEvents {
  const f = (): Float32Array => new Float32Array(capacity)
  return {
    capacity, x: f(), y: f(), z: f(), team: new Int8Array(capacity),
    radius: f(), damage: f(), smoke: f(), blast: f(), shake: f(),
    count: 0, dropped: 0,
  }
}

export function clearBursts(e: BurstEvents): void {
  e.count = 0
  e.dropped = 0
}

export function clearFlak(f: FlakShells): void {
  f.team.fill(-1)
  f.live = 0
}

/**
 * 發射一發，回傳槽位索引；**池滿時回傳 −1（拒絕發射）**。
 *
 * 【為什麼與 `Projectiles` 相反 —— 那邊是覆寫最舊的】那邊覆寫是為了「扣了
 * 扳機一定有反應」，因為那是玩家的槍。高砲是 AI 的，而覆寫一發**還沒引爆**
 * 的砲彈等於憑空吃掉一朵雲；池又有十倍餘裕，滿了代表別的地方出錯了。
 */
export function spawnFlak(
  f: FlakShells,
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  fuse: number, team: number,
  radius: number = FLAK_RADIUS, damage: number = FLAK_DAMAGE,
  smoke: number = FLAK_SMOKE, blast: number = FLAK_BLAST_SCALE,
  shake: number = FLAK_SHAKE,
): number {
  for (let i = 0; i < f.capacity; i++) {
    if (f.team[i] !== -1) continue
    f.x[i] = px; f.y[i] = py; f.z[i] = pz
    f.vx[i] = vx; f.vy[i] = vy; f.vz[i] = vz
    f.fuse[i] = fuse
    f.team[i] = team
    f.radius[i] = radius; f.damage[i] = damage
    f.smoke[i] = smoke; f.blast[i] = blast; f.shake[i] = shake
    f.live++
    return i
  }
  return -1
}

/**
 * 推進一步：等速直線，引信倒數，歸零就引爆。
 *
 * 【先推進再減引信】引爆點是**那一刻的位置**。先減引信的話，最後一步的
 * 位移會被吃掉 —— 450 m/s 下差 1.9 m，看不出來，但那是一個無聲的偏差。
 */
export function stepFlak(f: FlakShells, dt: number, out: BurstEvents): void {
  for (let i = 0; i < f.capacity; i++) {
    if (f.team[i] === -1) continue

    f.x[i] = f.x[i]! + f.vx[i]! * dt
    f.y[i] = f.y[i]! + f.vy[i]! * dt
    f.z[i] = f.z[i]! + f.vz[i]! * dt

    const fuse = f.fuse[i]! - dt
    if (fuse > 0) {
      f.fuse[i] = fuse
      continue
    }

    pushBurst(out, f.x[i]!, f.y[i]!, f.z[i]!, f.team[i]!,
      f.radius[i]!, f.damage[i]!, f.smoke[i]!, f.blast[i]!, f.shake[i]!)
    f.team[i] = -1
    f.live--
  }
}

export function pushBurst(
  e: BurstEvents, x: number, y: number, z: number, team: number,
  radius: number = FLAK_RADIUS, damage: number = FLAK_DAMAGE,
  smoke: number = FLAK_SMOKE, blast: number = FLAK_BLAST_SCALE,
  shake: number = FLAK_SHAKE,
): void {
  if (e.count >= e.capacity) {
    e.dropped++
    return
  }
  const i = e.count++
  e.x[i] = x; e.y[i] = y; e.z[i] = z
  e.team[i] = team
  e.radius[i] = radius; e.damage[i] = damage
  e.smoke[i] = smoke; e.blast[i] = blast; e.shake[i] = shake
}

/**
 * 離爆心 `distance` 公尺處扣多少血。線性衰減，半徑外為 0。
 *
 * 【半徑與爆心傷害逐發帶】艦砲與陸砲的強度是兩份表；用模組常數的話調一邊
 * 會動到另一邊。
 *
 * 【半徑外一定要夾成 0】不夾的話公式會給出負數 —— 遠方的飛機會被「治療」，
 * 而且那個錯誤在畫面上完全看不出來。
 */
export function flakDamage(
  distance: number, radius: number = FLAK_RADIUS, damage: number = FLAK_DAMAGE,
): number {
  if (distance >= radius) return 0
  return damage * (1 - distance / radius)
}
