import type { WaSqliteDriver, WaSqliteStorageOptions } from '@store/types'
import { isBunRuntime } from '@util/runtime'

type SqliteStatementLike = {
    readonly run: (...args: unknown[]) => unknown
    readonly get: (...args: unknown[]) => unknown
    readonly all: (...args: unknown[]) => unknown
}

type SqliteDatabaseLike = {
    readonly exec: (sql: string) => unknown
    readonly close: () => unknown
    readonly pragma?: (pragma: string) => unknown
    readonly prepare?: (sql: string) => SqliteStatementLike
    readonly query?: (sql: string) => SqliteStatementLike
}

export type SqliteParams = readonly unknown[]

export interface WaSqliteConnection {
    readonly driver: Exclude<WaSqliteDriver, 'auto'>
    exec(sql: string): void
    run(sql: string, params?: SqliteParams): void
    get<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T | null
    all<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): readonly T[]
    close(): void
}

const BETTER_SQLITE3_MODULE = 'better-sqlite3'
const BUN_SQLITE_MODULE = 'bun:sqlite'

async function importModule(moduleName: string): Promise<unknown> {
    return import(moduleName)
}

function asConstructor(loaded: unknown): new (path: string) => SqliteDatabaseLike {
    if (typeof loaded === 'function') {
        return loaded as new (path: string) => SqliteDatabaseLike
    }
    if (loaded && typeof loaded === 'object') {
        const candidate = (loaded as { default?: unknown }).default
        if (typeof candidate === 'function') {
            return candidate as new (path: string) => SqliteDatabaseLike
        }
    }
    throw new Error('invalid sqlite driver export')
}

function statementFor(db: SqliteDatabaseLike, sql: string): SqliteStatementLike {
    const prepare = db.prepare ?? db.query
    if (!prepare) {
        throw new Error('sqlite driver does not expose prepare/query method')
    }
    const statement = prepare.call(db, sql)
    if (
        !statement ||
        typeof statement.run !== 'function' ||
        typeof statement.get !== 'function' ||
        typeof statement.all !== 'function'
    ) {
        throw new Error('invalid sqlite statement API')
    }
    return statement
}

function callWithParams(
    method: (...args: unknown[]) => unknown,
    params: SqliteParams | undefined
): unknown {
    if (!params || params.length === 0) {
        return method()
    }
    return method(...params)
}

function wrapConnection(
    db: SqliteDatabaseLike,
    driver: Exclude<WaSqliteDriver, 'auto'>
): WaSqliteConnection {
    return {
        driver,
        exec(sql) {
            db.exec(sql)
        },
        run(sql, params) {
            const statement = statementFor(db, sql)
            callWithParams(statement.run.bind(statement), params)
        },
        get<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T | null {
            const statement = statementFor(db, sql)
            const row = callWithParams(statement.get.bind(statement), params)
            return (row as T | undefined) ?? null
        },
        all<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): readonly T[] {
            const statement = statementFor(db, sql)
            const rows = callWithParams(statement.all.bind(statement), params)
            return Array.isArray(rows) ? (rows as readonly T[]) : []
        },
        close() {
            db.close()
        }
    }
}

function pragmaEntries(options: WaSqliteStorageOptions): readonly [string, string | number][] {
    return Object.entries(options.pragmas ?? {})
}

function applyPragmas(db: SqliteDatabaseLike, options: WaSqliteStorageOptions): void {
    for (const [key, value] of pragmaEntries(options)) {
        if (db.pragma) {
            db.pragma(`${key}=${value}`)
            continue
        }
        db.exec(`PRAGMA ${key}=${value}`)
    }
}

async function openBetterSqlite(options: WaSqliteStorageOptions): Promise<WaSqliteConnection> {
    try {
        const loaded = await importModule(BETTER_SQLITE3_MODULE)
        const Database = asConstructor(loaded)
        const db = new Database(options.path)
        applyPragmas(db, options)
        return wrapConnection(db, 'better-sqlite3')
    } catch {
        throw new Error(
            'optional dependency "better-sqlite3" is not installed. Install with: npm i better-sqlite3'
        )
    }
}

async function openBunSqlite(options: WaSqliteStorageOptions): Promise<WaSqliteConnection> {
    try {
        const loaded = await importModule(BUN_SQLITE_MODULE)
        if (!loaded || typeof loaded !== 'object') {
            throw new Error('invalid bun sqlite module export')
        }
        const ctor = (loaded as { Database?: unknown }).Database
        if (typeof ctor !== 'function') {
            throw new Error('invalid bun sqlite module export')
        }
        const db = new (ctor as new (path: string) => SqliteDatabaseLike)(options.path)
        applyPragmas(db, options)
        return wrapConnection(db, 'bun')
    } catch {
        throw new Error(
            'bun runtime sqlite module "bun:sqlite" is unavailable. Run this in Bun or set storage.sqlite.driver to "better-sqlite3".'
        )
    }
}

function resolveDriver(requested: WaSqliteDriver | undefined): WaSqliteDriver {
    if (requested && requested !== 'auto') {
        return requested
    }
    return isBunRuntime() ? 'bun' : 'better-sqlite3'
}

export async function openSqliteConnection(
    options: WaSqliteStorageOptions
): Promise<WaSqliteConnection> {
    const driver = resolveDriver(options.driver)
    if (driver === 'bun') {
        return openBunSqlite(options)
    }
    return openBetterSqlite(options)
}
