import { aesGcmDecrypt, aesGcmEncrypt, importAesGcmKey } from '@crypto'
import {
    assertMessageSecret,
    createUseCaseSecret,
    WA_USE_CASE_SECRET_MODIFICATION_TYPES
} from '@message/use-case-secret'
import { EMPTY_BYTES, TEXT_ENCODER, toBytesView } from '@util/bytes'

const WA_ADDON_ENCRYPTION_NONCE_BYTES = 12

type WaAddonBytes = Uint8Array | ArrayBuffer | ArrayBufferView

export function shouldUseAddonAdditionalData(
    modificationType: (typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES)[keyof typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES]
): boolean {
    return (
        modificationType === WA_USE_CASE_SECRET_MODIFICATION_TYPES.POLL_VOTE ||
        modificationType === WA_USE_CASE_SECRET_MODIFICATION_TYPES.EVENT_RESPONSE
    )
}

export function buildAddonAdditionalData(stanzaId: string, addOnSenderJid: string): Uint8Array {
    if (!stanzaId.trim()) {
        throw new Error('stanza id must be a non-empty string')
    }
    if (!addOnSenderJid.trim()) {
        throw new Error('addon sender jid must be a non-empty string')
    }
    return TEXT_ENCODER.encode(`${stanzaId}\u0000${addOnSenderJid}`)
}

export async function encryptAddonPayload(input: {
    readonly messageSecret: WaAddonBytes
    readonly stanzaId: string
    readonly parentMsgOriginalSender: string
    readonly modificationSender: string
    readonly modificationType: (typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES)[keyof typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES]
    readonly payload: WaAddonBytes
    readonly iv: WaAddonBytes
    readonly additionalData?: WaAddonBytes
}): Promise<Uint8Array> {
    const secret = await createUseCaseSecret({
        messageSecret: assertMessageSecret(input.messageSecret),
        stanzaId: input.stanzaId,
        parentMsgOriginalSender: input.parentMsgOriginalSender,
        modificationSender: input.modificationSender,
        modificationType: input.modificationType
    })
    const key = await importAesGcmKey(secret, ['encrypt'])
    const iv = assertAddonIv(input.iv)
    const additionalData = resolveAddonAdditionalData(input)
    return aesGcmEncrypt(key, iv, toBytesView(input.payload), additionalData)
}

export async function decryptAddonPayload(input: {
    readonly messageSecret: WaAddonBytes
    readonly stanzaId: string
    readonly parentMsgOriginalSender: string
    readonly modificationSender: string
    readonly modificationType: (typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES)[keyof typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES]
    readonly ciphertext: WaAddonBytes
    readonly iv: WaAddonBytes
    readonly additionalData?: WaAddonBytes
}): Promise<Uint8Array> {
    const secret = await createUseCaseSecret({
        messageSecret: assertMessageSecret(input.messageSecret),
        stanzaId: input.stanzaId,
        parentMsgOriginalSender: input.parentMsgOriginalSender,
        modificationSender: input.modificationSender,
        modificationType: input.modificationType
    })
    const key = await importAesGcmKey(secret, ['decrypt'])
    const iv = assertAddonIv(input.iv)
    const additionalData = resolveAddonAdditionalData(input)
    return aesGcmDecrypt(key, iv, toBytesView(input.ciphertext), additionalData)
}

function assertAddonIv(iv: WaAddonBytes): Uint8Array {
    const normalized = toBytesView(iv)
    if (normalized.byteLength !== WA_ADDON_ENCRYPTION_NONCE_BYTES) {
        throw new Error(
            `addon iv must be ${WA_ADDON_ENCRYPTION_NONCE_BYTES} bytes (got ${normalized.byteLength})`
        )
    }
    return normalized
}

function resolveAddonAdditionalData(input: {
    readonly stanzaId: string
    readonly modificationSender: string
    readonly modificationType: (typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES)[keyof typeof WA_USE_CASE_SECRET_MODIFICATION_TYPES]
    readonly additionalData?: WaAddonBytes
}): Uint8Array {
    if (input.additionalData) {
        return toBytesView(input.additionalData)
    }
    if (!shouldUseAddonAdditionalData(input.modificationType)) {
        return EMPTY_BYTES
    }
    return buildAddonAdditionalData(input.stanzaId, input.modificationSender)
}
