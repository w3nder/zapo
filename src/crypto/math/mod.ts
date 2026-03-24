import { FIELD_P, GROUP_L } from '@crypto/math/constants'

// Fast reduction mask: 2^255 - 1
const MASK255 = (1n << 255n) - 1n

/**
 * Fast modular reduction for p = 2^255-19.
 * Replaces BigInt division (%) with shifts and multiplication by 19,
 * exploiting 2^255 ≡ 19 (mod p).
 */
function reduceP(x: bigint): bigint {
    if (x < 0n) x += FIELD_P
    if (x < FIELD_P) return x
    while (x >= 1n << 255n) {
        x = (x & MASK255) + (x >> 255n) * 19n
    }
    return x >= FIELD_P ? x - FIELD_P : x
}

/** Add two reduced values mod p (no shifts needed, just a comparison) */
export function fAdd(a: bigint, b: bigint): bigint {
    const r = a + b
    return r >= FIELD_P ? r - FIELD_P : r
}

/** Subtract two reduced values mod p */
export function fSub(a: bigint, b: bigint): bigint {
    const r = a - b
    return r < 0n ? r + FIELD_P : r
}

/** Negate a reduced value mod p */
export function fNeg(a: bigint): bigint {
    return a === 0n ? 0n : FIELD_P - a
}

/** Multiply and reduce mod p (shift-based, no BigInt division) */
export function fMul(a: bigint, b: bigint): bigint {
    const x = a * b
    let r = (x & MASK255) + (x >> 255n) * 19n
    if (r >= 1n << 255n) {
        r = (r & MASK255) + (r >> 255n) * 19n
    }
    return r >= FIELD_P ? r - FIELD_P : r
}

export function mod(value: bigint, modulus = FIELD_P): bigint {
    if (modulus === FIELD_P) return reduceP(value)
    const remainder = value % modulus
    return remainder >= 0n ? remainder : remainder + modulus
}

export function modGroup(value: bigint): bigint {
    return mod(value, GROUP_L)
}

export function modInv(value: bigint, modulus = FIELD_P): bigint {
    if (value === 0n) {
        throw new Error('field inversion by zero')
    }
    if (modulus === FIELD_P) {
        return fieldInv(value)
    }
    return modPow(value, modulus - 2n, modulus)
}

/**
 * Optimized field inversion for p = 2^255-19 using an addition chain
 * with fast reduction. 254 squarings + 11 multiplications, each using
 * shift-based reduction instead of BigInt division.
 */
function fieldInv(x: bigint): bigint {
    const x2 = fMul(x, x)
    const x4 = fMul(x2, x2)
    const x8 = fMul(x4, x4)
    const x9 = fMul(x8, x)
    const x11 = fMul(x9, x2)
    const x22 = fMul(x11, x11)
    const x_5_0 = fMul(x22, x9)

    let t = sqrNP(x_5_0, 5)
    const x_10_0 = fMul(t, x_5_0)

    t = sqrNP(x_10_0, 10)
    const x_20_0 = fMul(t, x_10_0)

    t = sqrNP(x_20_0, 20)
    const x_40_0 = fMul(t, x_20_0)

    t = sqrNP(x_40_0, 10)
    const x_50_0 = fMul(t, x_10_0)

    t = sqrNP(x_50_0, 50)
    const x_100_0 = fMul(t, x_50_0)

    t = sqrNP(x_100_0, 100)
    const x_200_0 = fMul(t, x_100_0)

    t = sqrNP(x_200_0, 50)
    const x_250_0 = fMul(t, x_50_0)

    t = sqrNP(x_250_0, 5)
    return fMul(t, x11)
}

function sqrNP(x: bigint, n: number): bigint {
    let r = x
    for (let i = 0; i < n; i++) {
        r = fMul(r, r)
    }
    return r
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (modulus <= 0n) {
        throw new Error('modulus must be positive')
    }
    let result = 1n
    let current = ((base % modulus) + modulus) % modulus
    let e = exponent
    while (e > 0n) {
        if ((e & 1n) === 1n) {
            result = (result * current) % modulus
        }
        current = (current * current) % modulus
        e >>= 1n
    }
    return result
}
