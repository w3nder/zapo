export interface WaParticipantsSnapshot {
    readonly groupJid: string
    readonly participants: readonly string[]
    readonly updatedAtMs: number
}

export interface WaParticipantsStore {
    getTtlMs(): number
    destroy?(): Promise<void>
    upsertGroupParticipants(snapshot: WaParticipantsSnapshot): Promise<void>
    getGroupParticipants(groupJid: string, nowMs?: number): Promise<WaParticipantsSnapshot | null>
    deleteGroupParticipants(groupJid: string): Promise<number>
    cleanupExpired(nowMs: number): Promise<number>
    clear(): Promise<void>
}
