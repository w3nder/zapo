import type { SenderKeyDistributionRecord, SenderKeyRecord, SignalAddress } from '@signal/types'

export interface WaSenderKeyStore {
    upsertSenderKey(record: SenderKeyRecord): Promise<void>
    upsertSenderKeyDistribution(record: SenderKeyDistributionRecord): Promise<void>
    getGroupSenderKeyList(groupId: string): Promise<{
        readonly skList: readonly SenderKeyRecord[]
        readonly skDistribList: readonly SenderKeyDistributionRecord[]
    }>
    getDeviceSenderKey(groupId: string, sender: SignalAddress): Promise<SenderKeyRecord | null>
    getDeviceSenderKeyDistribution(
        groupId: string,
        sender: SignalAddress
    ): Promise<SenderKeyDistributionRecord | null>
    deleteDeviceSenderKey(target: SignalAddress, groupId?: string): Promise<number>
    markForgetSenderKey(groupId: string, participants: readonly SignalAddress[]): Promise<number>
}
