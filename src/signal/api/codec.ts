import { decodeNodeContentBase64OrBytes } from '@transport/node/helpers'
import type { BinaryNode } from '@transport/types'

export function decodeExactLength(
    value: BinaryNode['content'],
    field: string,
    expectedLength: number
): Uint8Array {
    const bytes = decodeNodeContentBase64OrBytes(value, field)
    if (bytes.byteLength !== expectedLength) {
        throw new Error(`${field} must be ${expectedLength} bytes`)
    }
    return bytes
}

export function parseUint(bytes: Uint8Array, field: string): number {
    if (bytes.byteLength === 1) {
        return bytes[0]
    }
    if (bytes.byteLength === 2) {
        return (bytes[0] << 8) | bytes[1]
    }
    if (bytes.byteLength === 3) {
        return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
    }
    if (bytes.byteLength === 4) {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
    }
    throw new Error(`${field} has invalid byte length`)
}
