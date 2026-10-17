import { beforeEach, describe, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ enabled: true, hooks: [] as any[], options: null as any,
    wire: null as any, direct: vi.fn(), job: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ fetchNative: state.direct, globalFetch: state.direct }))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => ({ nodeOnlyServerSideRequests: state.enabled }) }))
vi.mock('src/ts/stores.svelte', () => ({ bodyIntercepterStore: state.hooks }))
vi.mock('src/ts/requestLog', () => ({ createRequestLogScope: () => ({ setRoute: vi.fn(), wrap: (fn: any) => fn, close: vi.fn() }) }))
vi.mock('./jobFetch', () => ({ makeJobFetch: (options: any) => { state.options = options; return state.job } }))
import { eligibleLegacyJob, legacyJsonFetch, legacyNativeFetch } from './legacyServerJob'
const arg = () => ({ realChatId: 'origin-chat', chatId: 'generation', mode: 'model', useStreaming: false, aiModel: 'original-model' } as any)
beforeEach(() => { state.enabled = true; state.hooks.length = 0; state.options = null; vi.clearAllMocks(); state.job.mockResolvedValue(new Response('{"content":[]}')); state.direct.mockResolvedValue({ ok: true }) })
describe('global server routing without changing model bindings', () => {
    test.each(['google-gemini', 'anthropic-messages', 'openai-compatible'] as const)('%s retains origin and model', async kind => {
        await legacyJsonFetch(arg(), kind, 'https://provider.example/messages', { body: { messages: [] } })
        expect(state.options).toMatchObject({ realChatId: 'origin-chat', generationId: 'generation', model: 'original-model', adapterKind: kind, backgroundBrowsing: true, streaming: false })
        expect(state.direct).not.toHaveBeenCalled()
    })
    test('disabled setting preserves direct route', async () => {
        state.enabled = false
        await legacyJsonFetch(arg(), 'anthropic-messages', 'https://provider.example/messages', { body: {} })
        expect(state.direct).toHaveBeenCalledOnce(); expect(state.job).not.toHaveBeenCalled()
    })
    test.each([{ tools: [{}] }, { stream: true }, { n: 2 }])('excludes browser-owned/multiple outputs: %j', body => expect(eligibleLegacyJob(true, arg(), body)).toBe(false))
    test('does not recover auxiliary or preview calls as chat messages', () => {
        expect(eligibleLegacyJob(true, { ...arg(), mode: 'memory' }, {})).toBe(false)
        expect(eligibleLegacyJob(true, { ...arg(), previewBody: true }, {})).toBe(false)
    })
    test('interceptor runs before journaling, exactly once', async () => {
        const hook = vi.fn((body: any) => ({ ...body, temperature: 0.7 })); state.hooks.push({ callback: hook })
        await legacyJsonFetch(arg(), 'anthropic-messages', 'https://provider.example/messages', { body: {}, interceptor: 'anthropic_http' })
        expect(hook).toHaveBeenCalledOnce(); expect(JSON.parse(state.job.mock.calls[0][1].body)).toEqual({ temperature: 0.7 })
    })
    test('interceptor-added tools retain direct ownership', async () => {
        state.hooks.push({ callback: () => JSON.stringify({ tools: [{}] }) })
        await legacyNativeFetch(arg(), 'google-gemini', 'https://provider.example/messages', { body: '{}', interceptor: 'gemini_base' })
        expect(state.job).not.toHaveBeenCalled(); expect(state.direct.mock.calls[0][1].interceptor).toBeUndefined()
    })
})
