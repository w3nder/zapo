import type { WaDeviceListSnapshot, WaDeviceListStore } from '@store/contracts/device-list.store'
import { BaseSqliteStore } from '@store/providers/sqlite/BaseSqliteStore'
import type { WaSqliteStorageOptions } from '@store/types'
import { asNumber, asString } from '@util/coercion'

interface DeviceListRow extends Record<string, unknown> {
    readonly user_jid: unknown
    readonly device_jids_json: unknown
    readonly updated_at_ms: unknown
    readonly expires_at_ms: unknown
}

const DEFAULT_DEVICE_LIST_TTL_MS = 5 * 60 * 1000

export class WaDeviceListSqliteStore extends BaseSqliteStore implements WaDeviceListStore {
    private readonly ttlMs: number

    public constructor(options: WaSqliteStorageOptions, ttlMs = DEFAULT_DEVICE_LIST_TTL_MS) {
        super(options, ['deviceList'])
        this.ttlMs = ttlMs
    }

    public getTtlMs(): number {
        return this.ttlMs
    }

    public async upsertUserDevices(snapshot: WaDeviceListSnapshot): Promise<void> {
        const db = await this.getConnection()
        db.run(
            `INSERT INTO device_list_cache (
                session_id,
                user_jid,
                device_jids_json,
                updated_at_ms,
                expires_at_ms
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id, user_jid) DO UPDATE SET
                device_jids_json=excluded.device_jids_json,
                updated_at_ms=excluded.updated_at_ms,
                expires_at_ms=excluded.expires_at_ms`,
            [
                this.options.sessionId,
                snapshot.userJid,
                JSON.stringify(snapshot.deviceJids),
                snapshot.updatedAtMs,
                snapshot.updatedAtMs + this.ttlMs
            ]
        )
    }

    public async getUserDevices(
        userJid: string,
        nowMs = Date.now()
    ): Promise<WaDeviceListSnapshot | null> {
        const db = await this.getConnection()
        const row = db.get<DeviceListRow>(
            `SELECT user_jid, device_jids_json, updated_at_ms, expires_at_ms
             FROM device_list_cache
             WHERE session_id = ? AND user_jid = ?`,
            [this.options.sessionId, userJid]
        )
        if (!row) {
            return null
        }

        const expiresAtMs = asNumber(row.expires_at_ms, 'device_list_cache.expires_at_ms')
        if (expiresAtMs <= nowMs) {
            db.run(
                `DELETE FROM device_list_cache
                 WHERE session_id = ? AND user_jid = ?`,
                [this.options.sessionId, userJid]
            )
            return null
        }

        return {
            userJid: asString(row.user_jid, 'device_list_cache.user_jid'),
            deviceJids: decodeDeviceJids(row.device_jids_json),
            updatedAtMs: asNumber(row.updated_at_ms, 'device_list_cache.updated_at_ms')
        }
    }

    public async deleteUserDevices(userJid: string): Promise<number> {
        const db = await this.getConnection()
        db.run(
            `DELETE FROM device_list_cache
             WHERE session_id = ? AND user_jid = ?`,
            [this.options.sessionId, userJid]
        )
        const row = db.get<Record<string, unknown>>('SELECT changes() AS total', [])
        return row ? Number(row.total) : 0
    }

    public async cleanupExpired(nowMs: number): Promise<number> {
        const db = await this.getConnection()
        db.run(
            `DELETE FROM device_list_cache
             WHERE session_id = ? AND expires_at_ms <= ?`,
            [this.options.sessionId, nowMs]
        )
        const row = db.get<Record<string, unknown>>('SELECT changes() AS total', [])
        return row ? Number(row.total) : 0
    }

    public async clear(): Promise<void> {
        const db = await this.getConnection()
        db.run('DELETE FROM device_list_cache WHERE session_id = ?', [this.options.sessionId])
    }
}

function decodeDeviceJids(raw: unknown): readonly string[] {
    const json = asString(raw, 'device_list_cache.device_jids_json')
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) {
        throw new Error('device_list_cache.device_jids_json must be an array')
    }
    return parsed.filter((entry): entry is string => {
        if (typeof entry !== 'string') {
            throw new Error('device_list_cache.device_jids_json entry must be string')
        }
        return true
    })
}
