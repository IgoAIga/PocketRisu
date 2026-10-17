import { fetchNative, globalFetch } from 'src/ts/globalApi.svelte'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { bodyIntercepterStore } from 'src/ts/stores.svelte'
import { makeJobFetch } from './jobFetch'
import type { RequestDataArgumentExtended } from './request'
import { createRequestLogScope } from 'src/ts/requestLog'

type Kind = 'google-gemini' | 'anthropic-messages' | 'openai-compatible'
type NativeArgs = Parameters<typeof fetchNative>[1]

// Only a single, buffered main response can be recovered with these decoders.
// Tool rounds, batches, previews and auxiliary pipelines retain their own lifecycle.
export function eligibleLegacyJob(enabled: boolean, arg: RequestDataArgumentExtended, body: any): boolean {
    return enabled && !!arg.realChatId && !!arg.chatId && arg.mode === 'model'
        && !arg.previewBody && !arg.useStreaming && !arg.multiGen
        && !arg.extractJson && !arg.imageResponse
        && !(arg.tools?.length) && !(body?.tools?.length) && !(body?.functions?.length)
        && !body?.stream && !(body?.n > 1)
}

async function runJob(arg: RequestDataArgumentExtended, kind: Kind, url: string, options: NativeArgs, body: any) {
    const db = getDatabase()
    const transport = makeJobFetch({
        realChatId: arg.realChatId!, generationId: arg.chatId!, adapterKind: kind,
        jobKind: 'main', streaming: false, backgroundBrowsing: true,
        model: arg.modelInfo?.internalID || arg.aiModel,
        modelLabel: arg.modelInfo?.name || arg.aiModel,
        inputTokens: arg.generationInfo?.inputTokens,
        outputTokens: arg.generationInfo?.outputTokens,
        maxContext: arg.generationInfo?.maxContext,
        timeoutMs: (db.localNetworkTimeoutSec ?? 600) * 1000,
        fallbackFetch: (async (_url, init) => fetchNative(url, {
            ...options, interceptor: undefined, body: init?.body as string,
        })) as typeof fetch,
    })
    const log = createRequestLogScope({ category: 'llm', source: options.logSource ?? 'main',
        chatId: arg.chatId, generationId: arg.chatId, model: arg.modelInfo?.id || arg.aiModel, streaming: false })
    log.setRoute('job')
    try {
        return await log.wrap(transport)(url, { method: options.method ?? 'POST', headers: options.headers,
            body: typeof body === 'string' ? body : JSON.stringify(body), signal: options.signal })
    } finally { void log.close() }
}

export async function legacyNativeFetch(arg: RequestDataArgumentExtended, kind: Kind, url: string, options: NativeArgs): Promise<Response> {
    let body: any
    try { body = JSON.parse(String(options.body)) } catch { return fetchNative(url, options) }
    if (!eligibleLegacyJob(getDatabase().nodeOnlyServerSideRequests === true, arg, body)) return fetchNative(url, options)
    let wire = String(options.body)
    if (options.interceptor) for (const hook of bodyIntercepterStore) {
        wire = await hook.callback(wire, options.interceptor) || wire
    }
    // Interceptors may introduce tools; those calls must remain browser-owned.
    if (!eligibleLegacyJob(true, arg, JSON.parse(wire))) return fetchNative(url, { ...options, body: wire, interceptor: undefined })
    return runJob(arg, kind, url, options, wire)
}

export async function legacyJsonFetch(arg: RequestDataArgumentExtended, kind: Kind, url: string, options: Parameters<typeof globalFetch>[1]) {
    if (!eligibleLegacyJob(getDatabase().nodeOnlyServerSideRequests === true, arg, options.body)) return globalFetch(url, options)
    let body = options.body
    if (options.interceptor) for (const hook of bodyIntercepterStore) {
        body = await hook.callback(body, options.interceptor) || body
    }
    if (!eligibleLegacyJob(true, arg, body)) return globalFetch(url, { ...options, body, interceptor: undefined })
    const response = await runJob(arg, kind, url, { ...options, signal: options.abortSignal, body: JSON.stringify(body) }, body)
    const text = await response.text()
    let data: any = text
    if (!options.rawResponse) { try { data = JSON.parse(text) } catch { /* retain provider error text */ } }
    return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers.entries()), data }
}
