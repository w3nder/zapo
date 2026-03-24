import { signalAddressKey } from '@protocol/jid'
import type {
    PreKeyRecord,
    RegistrationInfo,
    SignalAddress,
    SignalSessionRecord,
    SignedPreKeyRecord
} from '@signal/types'
import type {
    WaSignalMetaSnapshot,
    WaSignalStore as WaSignalStoreContract
} from '@store/contracts/signal.store'
import { resolvePositive } from '@util/coercion'
import { setBoundedMapEntry } from '@util/collections'

const DEFAULT_SIGNAL_STORE_LIMITS = Object.freeze({
    preKeys: 4_096,
    sessions: 8_192,
    remoteIdentities: 8_192
})

export interface WaSignalMemoryStoreOptions {
    readonly maxPreKeys?: number
    readonly maxSessions?: number
    readonly maxRemoteIdentities?: number
}

export class WaSignalMemoryStore implements WaSignalStoreContract {
    private registrationInfo: RegistrationInfo | null
    private signedPreKey: SignedPreKeyRecord | null
    private signedPreKeyRotationTs: number | null
    private readonly preKeys: Map<number, PreKeyRecord>
    private readonly uploadedPreKeys: Set<number>
    private serverHasPreKeys: boolean
    private readonly signalSessions: Map<string, SignalSessionRecord>
    private readonly remoteIdentities: Map<string, Uint8Array>
    private nextPreKeyId: number
    private readonly maxPreKeys: number
    private readonly maxSessions: number
    private readonly maxRemoteIdentities: number

    public constructor(options: WaSignalMemoryStoreOptions = {}) {
        this.registrationInfo = null
        this.signedPreKey = null
        this.signedPreKeyRotationTs = null
        this.preKeys = new Map()
        this.uploadedPreKeys = new Set()
        this.serverHasPreKeys = false
        this.signalSessions = new Map()
        this.remoteIdentities = new Map()
        this.nextPreKeyId = 1
        this.maxPreKeys = resolvePositive(
            options.maxPreKeys,
            DEFAULT_SIGNAL_STORE_LIMITS.preKeys,
            'WaSignalMemoryStoreOptions.maxPreKeys'
        )
        this.maxSessions = resolvePositive(
            options.maxSessions,
            DEFAULT_SIGNAL_STORE_LIMITS.sessions,
            'WaSignalMemoryStoreOptions.maxSessions'
        )
        this.maxRemoteIdentities = resolvePositive(
            options.maxRemoteIdentities,
            DEFAULT_SIGNAL_STORE_LIMITS.remoteIdentities,
            'WaSignalMemoryStoreOptions.maxRemoteIdentities'
        )
    }

    public async getRegistrationInfo(): Promise<RegistrationInfo | null> {
        return this.registrationInfo
    }

    public async setRegistrationInfo(info: RegistrationInfo): Promise<void> {
        this.registrationInfo = info
    }

    public async getSignedPreKey(): Promise<SignedPreKeyRecord | null> {
        return this.signedPreKey
    }

    public async setSignedPreKey(record: SignedPreKeyRecord): Promise<void> {
        this.signedPreKey = record
    }

    public async getSignedPreKeyById(keyId: number): Promise<SignedPreKeyRecord | null> {
        if (!this.signedPreKey) {
            return null
        }
        return this.signedPreKey.keyId === keyId ? this.signedPreKey : null
    }

    public async setSignedPreKeyRotationTs(value: number | null): Promise<void> {
        this.signedPreKeyRotationTs = value
    }

    public async getSignedPreKeyRotationTs(): Promise<number | null> {
        return this.signedPreKeyRotationTs
    }

    public async putPreKey(record: PreKeyRecord): Promise<void> {
        setBoundedMapEntry(this.preKeys, record.keyId, record, this.maxPreKeys, (keyId) => {
            this.uploadedPreKeys.delete(keyId)
        })
        if (record.keyId >= this.nextPreKeyId) {
            this.nextPreKeyId = record.keyId + 1
        }
    }

    public async getOrGenPreKeys(
        count: number,
        generator: (keyId: number) => PreKeyRecord | Promise<PreKeyRecord>
    ): Promise<readonly PreKeyRecord[]> {
        if (!Number.isSafeInteger(count) || count <= 0) {
            throw new Error(`invalid prekey count: ${count}`)
        }

        const available: PreKeyRecord[] = []
        const availableKeyIds: number[] = []
        for (const keyId of this.preKeys.keys()) {
            if (!this.uploadedPreKeys.has(keyId)) {
                availableKeyIds.push(keyId)
            }
        }
        availableKeyIds.sort((left, right) => left - right)
        for (let index = 0; index < availableKeyIds.length; index += 1) {
            const keyId = availableKeyIds[index]
            const record = this.preKeys.get(keyId)
            if (!record) {
                continue
            }
            available.push(record)
            if (available.length >= count) {
                return available
            }
        }

        while (available.length < count) {
            const record = await generator(this.nextPreKeyId++)
            setBoundedMapEntry(this.preKeys, record.keyId, record, this.maxPreKeys, (keyId) => {
                this.uploadedPreKeys.delete(keyId)
            })
            available.push(record)
        }
        return available
    }

    public async getPreKeyById(keyId: number): Promise<PreKeyRecord | null> {
        return this.preKeys.get(keyId) ?? null
    }

    public async getPreKeysById(
        keyIds: readonly number[]
    ): Promise<readonly (PreKeyRecord | null)[]> {
        const result = new Array<PreKeyRecord | null>(keyIds.length)
        for (let i = 0; i < keyIds.length; i += 1) {
            result[i] = this.preKeys.get(keyIds[i]) ?? null
        }
        return result
    }

    public async consumePreKeyById(keyId: number): Promise<PreKeyRecord | null> {
        const record = this.preKeys.get(keyId) ?? null
        if (!record) {
            return null
        }
        this.preKeys.delete(keyId)
        this.uploadedPreKeys.delete(keyId)
        return record
    }

    public async getOrGenSinglePreKey(
        generator: (keyId: number) => PreKeyRecord | Promise<PreKeyRecord>
    ): Promise<PreKeyRecord> {
        const preKeys = await this.getOrGenPreKeys(1, generator)
        return preKeys[0]
    }

    public async markKeyAsUploaded(keyId: number): Promise<void> {
        if (keyId < 0 || keyId >= this.nextPreKeyId) {
            throw new Error(`prekey ${keyId} is out of boundary`)
        }
        for (const candidate of this.preKeys.keys()) {
            if (candidate <= keyId) {
                this.addUploadedPreKey(candidate)
            }
        }
    }

    public async setServerHasPreKeys(value: boolean): Promise<void> {
        this.serverHasPreKeys = value
    }

    public async getServerHasPreKeys(): Promise<boolean> {
        return this.serverHasPreKeys
    }

    public async getSignalMeta(): Promise<WaSignalMetaSnapshot> {
        return {
            serverHasPreKeys: this.serverHasPreKeys,
            signedPreKeyRotationTs: this.signedPreKeyRotationTs,
            registrationInfo: this.registrationInfo,
            signedPreKey: this.signedPreKey
        }
    }

    public async hasSession(address: SignalAddress): Promise<boolean> {
        return this.signalSessions.has(signalAddressKey(address))
    }

    public async hasSessions(addresses: readonly SignalAddress[]): Promise<readonly boolean[]> {
        const result = new Array<boolean>(addresses.length)
        for (let i = 0; i < addresses.length; i += 1) {
            result[i] = this.signalSessions.has(signalAddressKey(addresses[i]))
        }
        return result
    }

    public async getSession(address: SignalAddress): Promise<SignalSessionRecord | null> {
        return this.signalSessions.get(signalAddressKey(address)) ?? null
    }

    public async getSessionsBatch(
        addresses: readonly SignalAddress[]
    ): Promise<readonly (SignalSessionRecord | null)[]> {
        const result = new Array<SignalSessionRecord | null>(addresses.length)
        for (let i = 0; i < addresses.length; i += 1) {
            result[i] = this.signalSessions.get(signalAddressKey(addresses[i])) ?? null
        }
        return result
    }

    public async setSession(address: SignalAddress, session: SignalSessionRecord): Promise<void> {
        setBoundedMapEntry(
            this.signalSessions,
            signalAddressKey(address),
            session,
            this.maxSessions
        )
    }

    public async setSessionsBatch(
        entries: readonly {
            readonly address: SignalAddress
            readonly session: SignalSessionRecord
        }[]
    ): Promise<void> {
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index]
            setBoundedMapEntry(
                this.signalSessions,
                signalAddressKey(entry.address),
                entry.session,
                this.maxSessions
            )
        }
    }

    public async deleteSession(address: SignalAddress): Promise<void> {
        this.signalSessions.delete(signalAddressKey(address))
    }

    public async getRemoteIdentity(address: SignalAddress): Promise<Uint8Array | null> {
        return this.remoteIdentities.get(signalAddressKey(address)) ?? null
    }

    public async getRemoteIdentities(
        addresses: readonly SignalAddress[]
    ): Promise<readonly (Uint8Array | null)[]> {
        const result = new Array<Uint8Array | null>(addresses.length)
        for (let i = 0; i < addresses.length; i += 1) {
            result[i] = this.remoteIdentities.get(signalAddressKey(addresses[i])) ?? null
        }
        return result
    }

    public async setRemoteIdentity(address: SignalAddress, identityKey: Uint8Array): Promise<void> {
        setBoundedMapEntry(
            this.remoteIdentities,
            signalAddressKey(address),
            identityKey,
            this.maxRemoteIdentities
        )
    }

    public async setRemoteIdentities(
        entries: readonly {
            readonly address: SignalAddress
            readonly identityKey: Uint8Array
        }[]
    ): Promise<void> {
        for (const entry of entries) {
            setBoundedMapEntry(
                this.remoteIdentities,
                signalAddressKey(entry.address),
                entry.identityKey,
                this.maxRemoteIdentities
            )
        }
    }

    public async clear(): Promise<void> {
        this.registrationInfo = null
        this.signedPreKey = null
        this.signedPreKeyRotationTs = null
        this.preKeys.clear()
        this.uploadedPreKeys.clear()
        this.serverHasPreKeys = false
        this.signalSessions.clear()
        this.remoteIdentities.clear()
        this.nextPreKeyId = 1
    }

    private addUploadedPreKey(keyId: number): void {
        this.uploadedPreKeys.add(keyId)
    }
}
