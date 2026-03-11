import type {
    AppStateCollectionName,
    WaAppStateStoreData,
    WaAppStateSyncKey
} from '@appstate/types'
import { proto } from '@proto'
import { asBytes, asNumber, asOptionalBytes, asString } from '@util/coercion'

export interface AppStateSyncKeyRow extends Record<string, unknown> {
    readonly key_id: unknown
    readonly key_data: unknown
    readonly timestamp: unknown
    readonly fingerprint: unknown
}

export interface AppStateCollectionVersionRow extends Record<string, unknown> {
    readonly collection: unknown
    readonly version: unknown
    readonly hash: unknown
}

export interface AppStateCollectionValueRow extends Record<string, unknown> {
    readonly collection: unknown
    readonly index_mac_hex: unknown
    readonly value_mac: unknown
}

export function encodeAppStateFingerprint(
    fingerprint: WaAppStateSyncKey['fingerprint']
): Uint8Array | null {
    if (!fingerprint) {
        return null
    }
    return proto.Message.AppStateSyncKeyFingerprint.encode(fingerprint).finish()
}

export function decodeAppStateFingerprint(
    raw: unknown
): WaAppStateSyncKey['fingerprint'] | undefined {
    const bytes = asOptionalBytes(raw, 'appstate_sync_keys.fingerprint')
    if (!bytes) {
        return undefined
    }
    return proto.Message.AppStateSyncKeyFingerprint.decode(bytes)
}

export function decodeAppStateSyncKeys(
    rows: readonly AppStateSyncKeyRow[]
): readonly WaAppStateSyncKey[] {
    return rows.map((row) => ({
        keyId: asBytes(row.key_id, 'appstate_sync_keys.key_id'),
        keyData: asBytes(row.key_data, 'appstate_sync_keys.key_data'),
        timestamp: asNumber(row.timestamp, 'appstate_sync_keys.timestamp'),
        fingerprint: decodeAppStateFingerprint(row.fingerprint)
    }))
}

export function decodeAppStateCollections(
    versionRows: readonly AppStateCollectionVersionRow[],
    valueRows: readonly AppStateCollectionValueRow[]
): WaAppStateStoreData['collections'] {
    const valueMapByCollection = new Map<string, Record<string, Uint8Array>>()
    for (const row of valueRows) {
        const collection = asString(row.collection, 'appstate_collection_index_values.collection')
        const byIndex = valueMapByCollection.get(collection) ?? {}
        byIndex[asString(row.index_mac_hex, 'appstate_collection_index_values.index_mac_hex')] =
            asBytes(row.value_mac, 'appstate_collection_index_values.value_mac')
        valueMapByCollection.set(collection, byIndex)
    }

    const collections: WaAppStateStoreData['collections'] = {}
    for (const row of versionRows) {
        const collection = asString(
            row.collection,
            'appstate_collection_versions.collection'
        ) as AppStateCollectionName
        collections[collection] = {
            version: asNumber(row.version, 'appstate_collection_versions.version'),
            hash: asBytes(row.hash, 'appstate_collection_versions.hash'),
            indexValueMap: valueMapByCollection.get(collection) ?? {}
        }
    }
    return collections
}
