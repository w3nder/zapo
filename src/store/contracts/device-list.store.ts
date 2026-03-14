export interface WaDeviceListSnapshot {
    readonly userJid: string
    readonly deviceJids: readonly string[]
    readonly updatedAtMs: number
}

export interface WaDeviceListStore {
    getTtlMs(): number
    destroy?(): Promise<void>
    upsertUserDevices(snapshot: WaDeviceListSnapshot): Promise<void>
    getUserDevices(userJid: string, nowMs?: number): Promise<WaDeviceListSnapshot | null>
    deleteUserDevices(userJid: string): Promise<number>
    cleanupExpired(nowMs: number): Promise<number>
    clear(): Promise<void>
}
