import type { Logger } from '@infra/log/types'
import { WA_DEFAULTS, WA_NODE_TAGS, WA_XMLNS } from '@protocol/constants'
import { parseSignalAddressFromJid, splitJid } from '@protocol/jid'
import { findNodeChild, getNodeChildrenByTag } from '@transport/node/helpers'
import { assertIqResult, buildIqNode } from '@transport/node/query'
import type { BinaryNode } from '@transport/types'

interface SignalDeviceSyncApiOptions {
    readonly logger: Logger
    readonly query: (node: BinaryNode, timeoutMs?: number) => Promise<BinaryNode>
    readonly defaultTimeoutMs?: number
    readonly hostDomain?: string
}

export interface SignalSyncedDeviceList {
    readonly jid: string
    readonly deviceJids: readonly string[]
}

export class SignalDeviceSyncApi {
    private readonly logger: SignalDeviceSyncApiOptions['logger']
    private readonly query: SignalDeviceSyncApiOptions['query']
    private readonly defaultTimeoutMs: number
    private readonly hostDomain: string

    public constructor(options: SignalDeviceSyncApiOptions) {
        this.logger = options.logger
        this.query = options.query
        this.defaultTimeoutMs =
            options.defaultTimeoutMs ?? WA_DEFAULTS.SIGNAL_FETCH_KEY_BUNDLES_TIMEOUT_MS
        this.hostDomain = options.hostDomain ?? WA_DEFAULTS.HOST_DOMAIN
    }

    public async syncDeviceList(
        userJids: readonly string[],
        timeoutMs = this.defaultTimeoutMs
    ): Promise<readonly SignalSyncedDeviceList[]> {
        const normalizedUsers = this.normalizeUsers(userJids)
        if (normalizedUsers.length === 0) {
            return []
        }

        const request = this.makeDeviceSyncRequest(normalizedUsers)
        this.logger.debug('signal device sync request', {
            users: normalizedUsers.length,
            timeoutMs
        })
        const response = await this.query(request, timeoutMs)
        const parsed = this.parseDeviceSyncResponse(response, normalizedUsers)
        this.logger.debug('signal device sync success', {
            users: parsed.length,
            devices: parsed.reduce((total, entry) => total + entry.deviceJids.length, 0)
        })
        return parsed
    }

    private makeDeviceSyncRequest(userJids: readonly string[]): BinaryNode {
        return buildIqNode('get', this.hostDomain, WA_XMLNS.USYNC, [
            {
                tag: WA_NODE_TAGS.USYNC,
                attrs: {
                    sid: this.makeSid(),
                    index: '0',
                    last: 'true',
                    mode: WA_NODE_TAGS.QUERY,
                    context: 'interactive'
                },
                content: [
                    {
                        tag: WA_NODE_TAGS.QUERY,
                        attrs: {},
                        content: [
                            {
                                tag: WA_NODE_TAGS.DEVICES,
                                attrs: {
                                    version: '2'
                                }
                            }
                        ]
                    },
                    {
                        tag: WA_NODE_TAGS.LIST,
                        attrs: {},
                        content: userJids.map((jid) => ({
                            tag: WA_NODE_TAGS.USER,
                            attrs: { jid }
                        }))
                    }
                ]
            }
        ])
    }

    private parseDeviceSyncResponse(
        node: BinaryNode,
        requestedUsers: readonly string[]
    ): readonly SignalSyncedDeviceList[] {
        assertIqResult(node, 'signal device sync')
        const usyncNode = findNodeChild(node, WA_NODE_TAGS.USYNC)
        if (!usyncNode) {
            throw new Error('signal device sync response missing usync node')
        }
        const listNode = findNodeChild(usyncNode, WA_NODE_TAGS.LIST)
        if (!listNode) {
            throw new Error('signal device sync response missing list node')
        }

        const requestedSet = new Set(requestedUsers)
        const out: SignalSyncedDeviceList[] = []
        const userNodes = getNodeChildrenByTag(listNode, WA_NODE_TAGS.USER)
        for (let index = 0; index < userNodes.length; index += 1) {
            const userNode = userNodes[index]
            const normalizedUserJid = userNode.attrs.jid
                ? this.normalizeUserJid(userNode.attrs.jid)
                : undefined
            if (!normalizedUserJid || !requestedSet.has(normalizedUserJid)) {
                continue
            }
            const deviceJids = this.parseUserDeviceJids(userNode, normalizedUserJid)
            out.push({
                jid: normalizedUserJid,
                deviceJids
            })
        }

        return out
    }

    private parseUserDeviceJids(userNode: BinaryNode, userJid: string): readonly string[] {
        const devicesNode = findNodeChild(userNode, WA_NODE_TAGS.DEVICES)
        if (!devicesNode) {
            return []
        }
        const errorNode = findNodeChild(devicesNode, WA_NODE_TAGS.ERROR)
        if (errorNode) {
            this.logger.warn('signal device sync user error', {
                jid: userJid,
                code: errorNode.attrs.code,
                text: errorNode.attrs.text
            })
            return []
        }

        const deviceListNode = findNodeChild(devicesNode, 'device-list')
        if (!deviceListNode) {
            return []
        }

        const dedup = new Set<string>()
        const deviceNodes = getNodeChildrenByTag(deviceListNode, 'device')
        for (let index = 0; index < deviceNodes.length; index += 1) {
            const deviceNode = deviceNodes[index]
            const rawId = deviceNode.attrs.id
            const parsedId = rawId ? Number.parseInt(rawId, 10) : Number.NaN
            if (!Number.isSafeInteger(parsedId) || parsedId < 0) {
                continue
            }
            dedup.add(this.toDeviceJid(userJid, parsedId))
        }
        return [...dedup]
    }

    private normalizeUsers(userJids: readonly string[]): readonly string[] {
        const dedup = new Set<string>()
        for (let index = 0; index < userJids.length; index += 1) {
            dedup.add(this.normalizeUserJid(userJids[index]))
        }
        return [...dedup]
    }

    private normalizeUserJid(jid: string): string {
        const parsed = splitJid(jid)
        const address = parseSignalAddressFromJid(jid)
        return `${address.user}@${parsed.server}`
    }

    private toDeviceJid(userJid: string, deviceId: number): string {
        const parsed = splitJid(userJid)
        if (deviceId === 0) {
            return `${parsed.user}@${parsed.server}`
        }
        return `${parsed.user}:${deviceId}@${parsed.server}`
    }

    private makeSid(): string {
        return `${Date.now()}.${Math.trunc(Math.random() * 1_000_000)}`
    }
}
