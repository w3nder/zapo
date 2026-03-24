import { BASE_POINT, IDENTITY_POINT, TWO_D } from '@crypto/math/constants'
import { bigIntToBytesLE } from '@crypto/math/le'
import { fAdd, fMul, fNeg, fSub, modGroup, modInv } from '@crypto/math/mod'
import type { ExtendedPoint } from '@crypto/math/types'

function addPoint(a: ExtendedPoint, b: ExtendedPoint): ExtendedPoint {
    const y1MinusX1 = fSub(a.y, a.x)
    const y2MinusX2 = fSub(b.y, b.x)
    const y1PlusX1 = fAdd(a.y, a.x)
    const y2PlusX2 = fAdd(b.y, b.x)
    const aTerm = fMul(y1MinusX1, y2MinusX2)
    const bTerm = fMul(y1PlusX1, y2PlusX2)
    const cTerm = fMul(fMul(TWO_D, a.t), b.t)
    const dTerm = fMul(fMul(2n, a.z), b.z)
    const eTerm = fSub(bTerm, aTerm)
    const fTerm = fSub(dTerm, cTerm)
    const gTerm = fAdd(dTerm, cTerm)
    const hTerm = fAdd(bTerm, aTerm)
    return {
        x: fMul(eTerm, fTerm),
        y: fMul(gTerm, hTerm),
        z: fMul(fTerm, gTerm),
        t: fMul(eTerm, hTerm)
    }
}

function doublePoint(point: ExtendedPoint): ExtendedPoint {
    const aTerm = fMul(point.x, point.x)
    const bTerm = fMul(point.y, point.y)
    const cTerm = fMul(fMul(2n, point.z), point.z)
    const dTerm = fNeg(aTerm)
    const xPlusY = fAdd(point.x, point.y)
    const eTerm = fSub(fMul(xPlusY, xPlusY), fAdd(aTerm, bTerm))
    const gTerm = fAdd(dTerm, bTerm)
    const fTerm = fSub(gTerm, cTerm)
    const hTerm = fSub(dTerm, bTerm)
    return {
        x: fMul(eTerm, fTerm),
        y: fMul(gTerm, hTerm),
        z: fMul(fTerm, gTerm),
        t: fMul(eTerm, hTerm)
    }
}

function negatePoint(p: ExtendedPoint): ExtendedPoint {
    return { x: fNeg(p.x), y: p.y, z: p.z, t: fNeg(p.t) }
}

const W = 5
const halfW = 1 << W
const mask = halfW - 1
const precomp: ExtendedPoint[] = new Array(1 << (W - 1))
precomp[0] = BASE_POINT
const _dbl = doublePoint(BASE_POINT)
for (let i = 1; i < precomp.length; i++) {
    precomp[i] = addPoint(precomp[i - 1], _dbl)
}

export function scalarMultBase(scalar: bigint): ExtendedPoint {
    let k = modGroup(scalar)
    if (k === 0n) return IDENTITY_POINT

    const naf = new Int8Array(256)
    let nafLen = 0
    while (k > 0n) {
        if ((k & 1n) === 1n) {
            let digit = Number(k & BigInt(mask))
            if (digit >= halfW >> 1) digit -= halfW
            naf[nafLen++] = digit
            k -= BigInt(digit)
        } else {
            nafLen++
        }
        k >>= 1n
    }

    let result = IDENTITY_POINT
    for (let i = nafLen - 1; i >= 0; i--) {
        result = doublePoint(result)
        const digit = naf[i]
        if (digit > 0) {
            result = addPoint(result, precomp[(digit - 1) >> 1])
        } else if (digit < 0) {
            result = addPoint(result, negatePoint(precomp[(-digit - 1) >> 1]))
        }
    }
    return result
}

export function encodeExtendedPoint(point: ExtendedPoint): Uint8Array {
    const zInv = modInv(point.z)
    const x = fMul(point.x, zInv)
    const y = fMul(point.y, zInv)
    const encoded = bigIntToBytesLE(y, 32)
    encoded[31] = (encoded[31] & 0x7f) | Number((x & 1n) << 7n)
    return encoded
}
