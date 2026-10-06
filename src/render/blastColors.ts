import { Color, SRGBColorSpace } from 'three'

const DUST_YOUNG = { r: 0.30, g: 0.19, b: 0.11 }
const DUST_OLD = { r: 0.16, g: 0.10, b: 0.06 }

/** Maps normalized dust age to its warm soil color. */
export function dustColor(t: number, out: Color): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out.setRGB(
    DUST_YOUNG.r + (DUST_OLD.r - DUST_YOUNG.r) * k,
    DUST_YOUNG.g + (DUST_OLD.g - DUST_YOUNG.g) * k,
    DUST_YOUNG.b + (DUST_OLD.b - DUST_YOUNG.b) * k,
    SRGBColorSpace,
  )
}

const SMOKE_BORN = { r: 0.03, g: 0.03, b: 0.028 }
const SMOKE_AGED = { r: 0.19, g: 0.185, b: 0.175 }
const SMOKE_WARM = 0.35

/** Maps normalized blast smoke age from black to deep gray. */
export function blastSmokeColor(t: number, out: Color): void {
  const k = t <= 0 ? 0 : t >= SMOKE_WARM ? 1 : t / SMOKE_WARM
  out.setRGB(
    SMOKE_BORN.r + (SMOKE_AGED.r - SMOKE_BORN.r) * k,
    SMOKE_BORN.g + (SMOKE_AGED.g - SMOKE_BORN.g) * k,
    SMOKE_BORN.b + (SMOKE_AGED.b - SMOKE_BORN.b) * k,
    SRGBColorSpace,
  )
}

const GLOW_HOT = { r: 1.0, g: 0.46, b: 0.14 }
const GLOW_MID = { r: 0.72, g: 0.16, b: 0.03 }
const GLOW_OUT = { r: 0.0, g: 0.0, b: 0.0 }

/** Maps normalized fire glow age from orange to black. */
export function fireGlowColor(t: number, out: Color): void {
  let a = GLOW_HOT
  let b = GLOW_MID
  let k = 0
  if (t <= 0.45) k = t / 0.45
  else {
    a = GLOW_MID
    b = GLOW_OUT
    k = Math.min(1, (t - 0.45) / 0.55)
  }
  out.setRGB(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    SRGBColorSpace,
  )
}

const MIST_TINT = { r: 0.95, g: 0.97, b: 1.0 }

/** Water mist keeps a constant white-blue tint throughout its lifetime. */
export function mistColor(_t: number, out: Color): void {
  out.setRGB(MIST_TINT.r, MIST_TINT.g, MIST_TINT.b, SRGBColorSpace)
}
