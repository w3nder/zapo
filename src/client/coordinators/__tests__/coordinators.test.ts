import assert from 'node:assert/strict'
import test from 'node:test'

import { WaIncomingNodeCoordinator } from '@client/coordinators/WaIncomingNodeCoordinator'
import { WaMessageDispatchCoordinator } from '@client/coordinators/WaMessageDispatchCoordinator'
import { createStreamControlHandler } from '@client/coordinators/WaStreamControlCoordinator'
import type { WaGroupEvent, WaGroupEventAction } from '@client/types'
import type { Logger } from '@infra/log/types'
import { WA_STREAM_SIGNALING } from '@protocol/constants'
import { WaParticipantsMemoryStore } from '@store/providers/memory/participants.store'

function createLogger(): Logger {
    return {
        level: 'trace',
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
    }
}

function createIncomingRuntime() {
    const unhandled: unknown[] = []
    return {
        runtime: {
            handleStreamControlResult: async () => undefined,
            persistSuccessAttributes: async () => undefined,
            emitSuccessNode: () => undefined,
            updateClockSkewFromSuccess: () => undefined,
            shouldWarmupMediaConn: () => false,
            warmupMediaConn: async () => undefined,
            persistRoutingInfo: async () => undefined,
            tryResolvePendingNode: () => false,
            handleGenericIncomingNode: async () => false,
            handleIncomingIqSetNode: async () => false,
            handleLinkCodeNotificationNode: async () => false,
            handleCompanionRegRefreshNotificationNode: async () => false,
            handleIncomingMessageNode: async () => false,
            sendNode: async () => undefined,
            handleIncomingRetryReceipt: async () => undefined,
            trackOutboundReceipt: async () => undefined,
            emitIncomingReceipt: () => undefined,
            emitIncomingPresence: () => undefined,
            emitIncomingChatstate: () => undefined,
            emitIncomingCall: () => undefined,
            emitIncomingFailure: () => undefined,
            emitIncomingErrorStanza: () => undefined,
            emitIncomingNotification: () => undefined,
            emitGroupEvent: () => undefined,
            emitUnhandledIncomingNode: (event: unknown) => {
                unhandled.push(event)
            },
            syncAppState: async () => undefined,
            disconnect: async () => undefined,
            clearStoredCredentials: async () => undefined,
            parseDirtyBits: () => [],
            handleDirtyBits: async () => undefined
        },
        unhandled
    }
}

function createGroupEvent(input: {
    readonly action: WaGroupEventAction
    readonly groupJid?: string
    readonly contextGroupJid?: string
    readonly authorJid?: string
    readonly participants?: readonly string[]
}): WaGroupEvent {
    return {
        rawNode: {
            tag: 'notification',
            attrs: {}
        },
        rawActionNode: {
            tag: input.action,
            attrs: {}
        },
        action: input.action,
        groupJid: input.groupJid,
        contextGroupJid: input.contextGroupJid,
        authorJid: input.authorJid,
        participants: input.participants?.map((jid) => ({ jid }))
    }
}

function createMessageDispatchCoordinator(
    participantsStore: WaParticipantsMemoryStore
): WaMessageDispatchCoordinator {
    return new WaMessageDispatchCoordinator({
        logger: createLogger(),
        messageClient: {} as never,
        retryStore: {} as never,
        participantsStore,
        buildMessageContent: async () => ({}),
        queryGroupParticipantJids: async () => [],
        senderKeyManager: {} as never,
        signalProtocol: {} as never,
        signalStore: {} as never,
        signalDeviceSync: {} as never,
        signalIdentitySync: {} as never,
        signalSessionSync: {} as never,
        getCurrentMeJid: () => null,
        getCurrentMeLid: () => null,
        getCurrentSignedIdentity: () => null
    })
}

test('incoming node coordinator supports dynamic handler registration and unregistration', async () => {
    const { runtime, unhandled } = createIncomingRuntime()
    const coordinator = new WaIncomingNodeCoordinator({
        logger: createLogger(),
        runtime
    })

    let handledCount = 0
    const handler = async () => {
        handledCount += 1
        return true
    }

    const unregister = coordinator.registerIncomingHandler({
        tag: 'custom',
        handler
    })

    await coordinator.handleIncomingNode({ tag: 'custom', attrs: {} })
    assert.equal(handledCount, 1)

    unregister()
    await coordinator.handleIncomingNode({ tag: 'custom', attrs: {} })
    assert.equal(handledCount, 1)
    assert.equal(unhandled.length, 1)
})

test('stream control handler runs force-login and resume flows', async () => {
    const calls: string[] = []
    const handler = createStreamControlHandler({
        logger: createLogger(),
        getComms: () =>
            ({
                closeSocketAndResume: async () => {
                    calls.push('resume')
                }
            }) as never,
        clearPendingQueries: () => {
            calls.push('clear_pending')
        },
        clearMediaConnCache: () => {
            calls.push('clear_media')
        },
        disconnect: async () => {
            calls.push('disconnect')
        },
        clearStoredCredentials: async () => {
            calls.push('clear_credentials')
        },
        connect: async () => {
            calls.push('connect')
        }
    })

    await handler.handleStreamControlResult({
        kind: 'stream_error_code',
        code: WA_STREAM_SIGNALING.FORCE_LOGIN_CODE
    })

    assert.deepEqual(calls, ['disconnect', 'clear_credentials', 'connect'])

    calls.length = 0
    await handler.handleStreamControlResult({
        kind: 'stream_error_code',
        code: 500
    })

    assert.deepEqual(calls, ['clear_pending', 'clear_media', 'resume'])
})

test('message dispatch coordinator mutates participants cache from group events', async () => {
    const participantsStore = new WaParticipantsMemoryStore(60_000)
    const coordinator = createMessageDispatchCoordinator(participantsStore)

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'create',
            groupJid: '120@g.us',
            participants: ['551100000000@s.whatsapp.net', '551199999999:3@s.whatsapp.net']
        })
    )

    const created = await participantsStore.getGroupParticipants('120@g.us')
    assert.ok(created)
    assert.deepEqual(created?.participants, [
        '551100000000@s.whatsapp.net',
        '551199999999@s.whatsapp.net'
    ])

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'add',
            groupJid: '120@g.us',
            participants: ['552200000000@s.whatsapp.net']
        })
    )
    const added = await participantsStore.getGroupParticipants('120@g.us')
    assert.deepEqual(added?.participants, [
        '551100000000@s.whatsapp.net',
        '551199999999@s.whatsapp.net',
        '552200000000@s.whatsapp.net'
    ])

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'remove',
            groupJid: '120@g.us',
            participants: ['551199999999@s.whatsapp.net']
        })
    )
    const removed = await participantsStore.getGroupParticipants('120@g.us')
    assert.deepEqual(removed?.participants, [
        '551100000000@s.whatsapp.net',
        '552200000000@s.whatsapp.net'
    ])

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'delete',
            groupJid: '120@g.us'
        })
    )
    assert.equal(await participantsStore.getGroupParticipants('120@g.us'), null)

    await participantsStore.destroy()
})

test('message dispatch coordinator handles linked and modify participant cache events', async () => {
    const participantsStore = new WaParticipantsMemoryStore(60_000)
    const coordinator = createMessageDispatchCoordinator(participantsStore)

    await participantsStore.upsertGroupParticipants({
        groupJid: 'child@g.us',
        participants: ['old@s.whatsapp.net', 'keep@s.whatsapp.net'],
        updatedAtMs: Date.now()
    })

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'linked_group_promote',
            groupJid: 'parent@g.us',
            contextGroupJid: 'child@g.us',
            participants: ['linked@s.whatsapp.net']
        })
    )

    const linked = await participantsStore.getGroupParticipants('child@g.us')
    assert.deepEqual(linked?.participants, [
        'old@s.whatsapp.net',
        'keep@s.whatsapp.net',
        'linked@s.whatsapp.net'
    ])
    assert.equal(await participantsStore.getGroupParticipants('parent@g.us'), null)

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'modify',
            groupJid: 'child@g.us',
            authorJid: 'old@s.whatsapp.net',
            participants: ['new@s.whatsapp.net']
        })
    )

    const modified = await participantsStore.getGroupParticipants('child@g.us')
    assert.deepEqual(modified?.participants, [
        'keep@s.whatsapp.net',
        'linked@s.whatsapp.net',
        'new@s.whatsapp.net'
    ])

    await coordinator.mutateParticipantsCacheFromGroupEvent(
        createGroupEvent({
            action: 'add',
            groupJid: 'uncached@g.us',
            participants: ['5511@s.whatsapp.net']
        })
    )
    assert.equal(await participantsStore.getGroupParticipants('uncached@g.us'), null)

    await participantsStore.destroy()
})
