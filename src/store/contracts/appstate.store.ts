import type {
    AppStateCollectionName,
    WaAppStateStoreData,
    WaAppStateSyncKey
} from '@appstate/types'

export interface WaAppStateCollectionStoreState {
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: ReadonlyMap<string, Uint8Array>
}

export interface WaAppStateStore {
    exportData(): Promise<WaAppStateStoreData>
    upsertSyncKeys(keys: readonly WaAppStateSyncKey[]): Promise<number>
    getSyncKeyData(keyId: Uint8Array): Promise<Uint8Array | null>
    getActiveSyncKey(): Promise<WaAppStateSyncKey | null>
    getCollectionState(collection: AppStateCollectionName): Promise<WaAppStateCollectionStoreState>
    setCollectionState(
        collection: AppStateCollectionName,
        version: number,
        hash: Uint8Array,
        indexValueMap: ReadonlyMap<string, Uint8Array>
    ): Promise<void>
    clear(): Promise<void>
}
