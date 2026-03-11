import type { WaSignalMessagePublishInput, WaSendMessageOptions } from '@client/types'
import { toSerializedPubKey } from '@crypto/core/keys'
import type { Logger } from '@infra/log/types'
import { resolveMessageTypeAttr } from '@message/content'
import { writeRandomPadMax16 } from '@message/padding'
import type {
    WaEncryptedMessageInput,
    WaMessagePublishOptions,
    WaMessagePublishResult,
    WaSendMessageContent,
    WaSendReceiptInput
} from '@message/types'
import type { WaMessageClient } from '@message/WaMessageClient'
import { proto } from '@proto'
import type { Proto } from '@proto'
import { WA_DEFAULTS } from '@protocol/constants'
import {
    isGroupJid,
    normalizeDeviceJid,
    normalizeRecipientJid,
    parseSignalAddressFromJid,
    toUserJid
} from '@protocol/jid'
import type { SignalDeviceSyncApi } from '@signal/api/SignalDeviceSyncApi'
import type { SignalSessionSyncApi } from '@signal/api/SignalSessionSyncApi'
import type { SenderKeyManager } from '@signal/group/SenderKeyManager'
import type { SignalProtocol } from '@signal/session/SignalProtocol'
import type { SignalAddress } from '@signal/types'
import { buildDirectMessageFanoutNode } from '@transport/node/builders/message'
import type { BinaryNode } from '@transport/types'
import { uint8Equal } from '@util/bytes'

interface WaMessageDispatchCoordinatorOptions {
    readonly logger: Logger
    readonly messageClient: WaMessageClient
    readonly buildMessageContent: (content: WaSendMessageContent) => Promise<Proto.IMessage>
    readonly senderKeyManager: SenderKeyManager
    readonly signalProtocol: SignalProtocol
    readonly signalDeviceSync: SignalDeviceSyncApi
    readonly signalSessionSync: SignalSessionSyncApi
    readonly getCurrentMeJid: () => string | null | undefined
    readonly getCurrentSignedIdentity: () => Proto.IADVSignedDeviceIdentity | null | undefined
}

export class WaMessageDispatchCoordinator {
    private readonly logger: Logger
    private readonly messageClient: WaMessageClient
    private readonly buildMessageContent: (content: WaSendMessageContent) => Promise<Proto.IMessage>
    private readonly senderKeyManager: SenderKeyManager
    private readonly signalProtocol: SignalProtocol
    private readonly signalDeviceSync: SignalDeviceSyncApi
    private readonly signalSessionSync: SignalSessionSyncApi
    private readonly getCurrentMeJid: () => string | null | undefined
    private readonly getCurrentSignedIdentity: () =>
        | Proto.IADVSignedDeviceIdentity
        | null
        | undefined

    public constructor(options: WaMessageDispatchCoordinatorOptions) {
        this.logger = options.logger
        this.messageClient = options.messageClient
        this.buildMessageContent = options.buildMessageContent
        this.senderKeyManager = options.senderKeyManager
        this.signalProtocol = options.signalProtocol
        this.signalDeviceSync = options.signalDeviceSync
        this.signalSessionSync = options.signalSessionSync
        this.getCurrentMeJid = options.getCurrentMeJid
        this.getCurrentSignedIdentity = options.getCurrentSignedIdentity
    }

    public async publishMessageNode(
        node: BinaryNode,
        options: WaMessagePublishOptions = {}
    ): Promise<WaMessagePublishResult> {
        this.logger.debug('wa client publish message node', {
            tag: node.tag,
            type: node.attrs.type,
            to: node.attrs.to
        })
        return this.messageClient.publishNode(node, options)
    }

    public async publishEncryptedMessage(
        input: WaEncryptedMessageInput,
        options: WaMessagePublishOptions = {}
    ): Promise<WaMessagePublishResult> {
        this.logger.debug('wa client publish encrypted message', {
            to: input.to,
            type: input.type,
            encType: input.encType
        })
        return this.messageClient.publishEncrypted(input, options)
    }

    public async publishSignalMessage(
        input: WaSignalMessagePublishInput,
        options: WaMessagePublishOptions = {}
    ): Promise<WaMessagePublishResult> {
        this.assertRegisteredSession('publishSignalMessage')
        const address = parseSignalAddressFromJid(input.to)
        if (address.server === WA_DEFAULTS.GROUP_SERVER) {
            throw new Error(
                'publishSignalMessage currently supports only direct chats; use sender-key flow for groups'
            )
        }
        this.logger.debug('wa client publish signal message', {
            to: input.to,
            type: input.type
        })
        const paddedPlaintext = await writeRandomPadMax16(input.plaintext)
        await this.ensureSignalSession(address, input.to, input.expectedIdentity)
        const encrypted = await this.signalProtocol.encryptMessage(
            address,
            paddedPlaintext,
            input.expectedIdentity
        )
        return this.messageClient.publishEncrypted(
            {
                to: input.to,
                encType: encrypted.type,
                ciphertext: encrypted.ciphertext,
                id: input.id,
                type: input.type,
                participant: input.participant,
                deviceFanout: input.deviceFanout
            },
            options
        )
    }

    public async sendMessage(
        to: string,
        content: WaSendMessageContent,
        options: WaSendMessageOptions = {}
    ): Promise<WaMessagePublishResult> {
        const recipientJid = normalizeRecipientJid(
            to,
            WA_DEFAULTS.HOST_DOMAIN,
            WA_DEFAULTS.GROUP_SERVER
        )
        const message = await this.buildMessageContent(content)
        const plaintext = await writeRandomPadMax16(proto.Message.encode(message).finish())
        const type = resolveMessageTypeAttr(message)

        if (isGroupJid(recipientJid, WA_DEFAULTS.GROUP_SERVER)) {
            const meJid = this.getCurrentMeJid()
            if (!meJid) {
                throw new Error('group send requires registered meJid')
            }
            const sender = parseSignalAddressFromJid(meJid)
            const encrypted = await this.senderKeyManager.encryptGroupMessage(
                recipientJid,
                sender,
                plaintext
            )
            return this.publishEncryptedMessage(
                {
                    to: recipientJid,
                    encType: 'skmsg',
                    ciphertext: encrypted.ciphertext,
                    id: options.id,
                    type
                },
                options
            )
        }

        return this.publishDirectSignalMessageWithFanout(recipientJid, plaintext, type, options)
    }

    public async syncSignalSession(jid: string, reasonIdentity = false): Promise<void> {
        const address = parseSignalAddressFromJid(jid)
        if (address.server === WA_DEFAULTS.GROUP_SERVER) {
            throw new Error('syncSignalSession supports only direct chats')
        }
        await this.ensureSignalSession(address, jid, undefined, reasonIdentity)
    }

    public async sendReceipt(input: WaSendReceiptInput): Promise<void> {
        await this.messageClient.sendReceipt(input)
    }

    private async publishDirectSignalMessageWithFanout(
        recipientJid: string,
        plaintext: Uint8Array,
        type: string,
        options: WaSendMessageOptions
    ): Promise<WaMessagePublishResult> {
        const meJid = this.requireCurrentMeJid('sendMessage')
        const deviceJids = await this.resolveDirectFanoutDeviceJids(recipientJid, meJid)
        const recipientUserJid = toUserJid(recipientJid)

        this.logger.debug('wa client publish signal fanout', {
            to: recipientJid,
            devices: deviceJids.length,
            type
        })

        const participants: {
            readonly jid: string
            readonly encType: 'msg' | 'pkmsg'
            readonly ciphertext: Uint8Array
        }[] = []
        let shouldAttachDeviceIdentity = false

        for (let index = 0; index < deviceJids.length; index += 1) {
            const targetJid = deviceJids[index]
            const address = parseSignalAddressFromJid(targetJid)
            const expectedIdentity =
                toUserJid(targetJid) === recipientUserJid ? options.expectedIdentity : undefined
            await this.ensureSignalSession(address, targetJid, expectedIdentity)
            const encrypted = await this.signalProtocol.encryptMessage(
                address,
                plaintext,
                expectedIdentity
            )
            participants.push({
                jid: targetJid,
                encType: encrypted.type,
                ciphertext: encrypted.ciphertext
            })
            if (encrypted.type === 'pkmsg') {
                shouldAttachDeviceIdentity = true
            }
        }

        const deviceIdentity = shouldAttachDeviceIdentity
            ? this.getEncodedSignedDeviceIdentity()
            : undefined
        const messageNode = buildDirectMessageFanoutNode({
            to: recipientJid,
            type,
            id: options.id,
            participants,
            deviceIdentity
        })

        return this.messageClient.publishNode(messageNode, options)
    }

    private async resolveDirectFanoutDeviceJids(
        recipientJid: string,
        meJid: string
    ): Promise<readonly string[]> {
        const recipientUserJid = toUserJid(recipientJid)
        const meUserJid = toUserJid(meJid)
        const targets =
            recipientUserJid === meUserJid ? [recipientUserJid] : [recipientUserJid, meUserJid]

        try {
            const synced = await this.signalDeviceSync.syncDeviceList(targets)
            const byUser = new Map<string, readonly string[]>(
                synced.map((entry) => [toUserJid(entry.jid), entry.deviceJids])
            )

            const fanout = new Set<string>()
            const recipientDevices = byUser.get(recipientUserJid) ?? []
            if (recipientDevices.length === 0) {
                fanout.add(recipientUserJid)
            } else {
                for (let index = 0; index < recipientDevices.length; index += 1) {
                    fanout.add(recipientDevices[index])
                }
            }

            const meDevices = byUser.get(meUserJid) ?? []
            const normalizedMeJid = normalizeDeviceJid(meJid)
            for (let index = 0; index < meDevices.length; index += 1) {
                const deviceJid = meDevices[index]
                if (normalizeDeviceJid(deviceJid) === normalizedMeJid) {
                    continue
                }
                fanout.add(deviceJid)
            }

            if (fanout.size === 0) {
                fanout.add(recipientUserJid)
            }
            return [...fanout]
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.logger.warn('signal device fanout sync failed, falling back to direct recipient', {
                to: recipientJid,
                message
            })
            return [recipientUserJid]
        }
    }

    private getEncodedSignedDeviceIdentity(): Uint8Array {
        const signedIdentity = this.getCurrentSignedIdentity()
        if (!signedIdentity) {
            throw new Error('missing signed identity for pkmsg fanout')
        }
        return proto.ADVSignedDeviceIdentity.encode(signedIdentity).finish()
    }

    private async ensureSignalSession(
        address: SignalAddress,
        jid: string,
        expectedIdentity?: Uint8Array,
        reasonIdentity = false
    ): Promise<void> {
        this.assertRegisteredSession('ensureSignalSession')
        if (await this.signalProtocol.hasSession(address)) {
            return
        }
        this.logger.info('signal session missing, fetching remote key bundle', { jid })
        const fetched = await this.signalSessionSync.fetchKeyBundle({
            jid,
            reasonIdentity
        })
        const remoteIdentity = toSerializedPubKey(fetched.bundle.identity)
        if (expectedIdentity && !uint8Equal(remoteIdentity, toSerializedPubKey(expectedIdentity))) {
            throw new Error('identity mismatch')
        }
        await this.signalProtocol.establishOutgoingSession(address, fetched.bundle)
        this.logger.info('signal session synchronized', {
            jid,
            regId: fetched.bundle.regId,
            hasOneTimeKey: fetched.bundle.oneTimeKey !== undefined
        })
    }

    private assertRegisteredSession(context: string): void {
        if (this.getCurrentMeJid()) {
            return
        }
        throw new Error(`${context} requires registered meJid`)
    }

    private requireCurrentMeJid(context: string): string {
        const meJid = this.getCurrentMeJid()
        if (meJid) {
            return meJid
        }
        throw new Error(`${context} requires registered meJid`)
    }
}
