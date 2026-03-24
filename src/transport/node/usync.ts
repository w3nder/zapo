import { createNodeIdGenerator } from './helpers'

export type WaUsyncSidGenerator = () => Promise<string>

export function createUsyncSidGenerator(): WaUsyncSidGenerator {
    const generatorPromise = createNodeIdGenerator()
    return async () => (await generatorPromise).next()
}
