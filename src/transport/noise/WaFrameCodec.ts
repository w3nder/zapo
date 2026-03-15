import { concatBytes, EMPTY_BYTES, toBytesView } from '@util/bytes'

const WA_MAX_FRAME_LENGTH = (1 << 24) - 1

function frameLength(header: Uint8Array): number {
    return (header[0] << 16) | (header[1] << 8) | header[2]
}

export class WaFrameCodec {
    private readonly introFrame: Uint8Array | null
    private readonly maxFrameLength: number
    private introSent: boolean
    private buffered: Uint8Array

    public constructor(introFrame?: Uint8Array, maxFrameLength = WA_MAX_FRAME_LENGTH) {
        if (!Number.isSafeInteger(maxFrameLength) || maxFrameLength <= 0) {
            throw new Error('maxFrameLength must be a positive safe integer')
        }
        if (maxFrameLength >= 1 << 24) {
            throw new Error('maxFrameLength must be lower than protocol limit (16777216)')
        }
        this.introFrame = introFrame && introFrame.length > 0 ? toBytesView(introFrame) : null
        this.maxFrameLength = maxFrameLength
        this.introSent = false
        this.buffered = EMPTY_BYTES
    }

    public encodeFrame(frame: Uint8Array): Uint8Array {
        if (frame.length > this.maxFrameLength) {
            throw new Error(
                `frame is too large: ${frame.length} bytes (max allowed: ${this.maxFrameLength})`
            )
        }
        if (!this.introSent && this.introFrame) {
            this.introSent = true
            const out = new Uint8Array(this.introFrame.length + 3 + frame.length)
            out.set(this.introFrame, 0)
            const headerOffset = this.introFrame.length
            out[headerOffset] = (frame.length >> 16) & 0xff
            out[headerOffset + 1] = (frame.length >> 8) & 0xff
            out[headerOffset + 2] = frame.length & 0xff
            out.set(frame, headerOffset + 3)
            return out
        }

        this.introSent = true
        const out = new Uint8Array(3 + frame.length)
        out[0] = (frame.length >> 16) & 0xff
        out[1] = (frame.length >> 8) & 0xff
        out[2] = frame.length & 0xff
        out.set(frame, 3)
        return out
    }

    public pushWireChunk(chunk: Uint8Array): readonly Uint8Array[] {
        if (chunk.length === 0) {
            return []
        }
        const frames: Uint8Array[] = []
        let chunkOffset = 0

        if (this.buffered.length > 0) {
            if (this.buffered.length < 3) {
                const missingHeaderBytes = 3 - this.buffered.length
                if (chunk.length < missingHeaderBytes) {
                    this.buffered = concatBytes([this.buffered, chunk])
                    return frames
                }

                const header = new Uint8Array(3)
                header.set(this.buffered, 0)
                header.set(chunk.subarray(0, missingHeaderBytes), this.buffered.length)
                const length = frameLength(header)
                if (length > this.maxFrameLength) {
                    throw new Error(
                        `incoming frame is too large: ${length} bytes (max allowed: ${this.maxFrameLength})`
                    )
                }

                const remainingAfterHeader = chunk.length - missingHeaderBytes
                if (remainingAfterHeader < length) {
                    const nextBuffered = new Uint8Array(3 + remainingAfterHeader)
                    nextBuffered.set(header, 0)
                    nextBuffered.set(chunk.subarray(missingHeaderBytes), 3)
                    this.buffered = nextBuffered
                    return frames
                }

                frames.push(chunk.subarray(missingHeaderBytes, missingHeaderBytes + length))
                chunkOffset = missingHeaderBytes + length
                this.buffered = EMPTY_BYTES
            } else {
                const header = this.buffered.subarray(0, 3)
                const length = frameLength(header)
                if (length > this.maxFrameLength) {
                    throw new Error(
                        `incoming frame is too large: ${length} bytes (max allowed: ${this.maxFrameLength})`
                    )
                }

                const bufferedPayloadLength = this.buffered.length - 3
                const missingPayloadBytes = length - bufferedPayloadLength
                if (missingPayloadBytes > chunk.length) {
                    this.buffered = concatBytes([this.buffered, chunk])
                    return frames
                }

                if (bufferedPayloadLength === 0) {
                    frames.push(chunk.subarray(0, missingPayloadBytes))
                } else {
                    const frame = new Uint8Array(length)
                    frame.set(this.buffered.subarray(3), 0)
                    if (missingPayloadBytes > 0) {
                        frame.set(chunk.subarray(0, missingPayloadBytes), bufferedPayloadLength)
                    }
                    frames.push(frame)
                }
                chunkOffset = missingPayloadBytes
                this.buffered = EMPTY_BYTES
            }
        }

        const remainingChunk = chunk.subarray(chunkOffset)
        let offset = 0
        while (remainingChunk.length - offset >= 3) {
            const header = remainingChunk.subarray(offset, offset + 3)
            const length = frameLength(header)
            if (length > this.maxFrameLength) {
                throw new Error(
                    `incoming frame is too large: ${length} bytes (max allowed: ${this.maxFrameLength})`
                )
            }
            if (remainingChunk.length - offset - 3 < length) {
                break
            }
            const start = offset + 3
            const end = start + length
            frames.push(remainingChunk.subarray(start, end))
            offset = end
        }
        this.buffered =
            offset >= remainingChunk.length ? EMPTY_BYTES : remainingChunk.subarray(offset)
        return frames
    }
}
