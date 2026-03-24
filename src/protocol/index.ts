export * from '@protocol/constants'
export {
    buildDeviceJid,
    canonicalizeSignalJid,
    canonicalizeSignalServer,
    getLoginIdentity,
    isHostedDeviceId,
    isHostedDeviceJid,
    isHostedServer,
    isGroupJid,
    normalizeDeviceJid,
    normalizeRecipientJid,
    parsePhoneJid,
    parseSignalAddressFromJid,
    splitJid,
    toUserJid
} from '@protocol/jid'
