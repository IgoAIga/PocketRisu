import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { beginOutputLifecycle } from './outputLifecycle'
import { requestStatuses, stopStatusTimer, recomputeEntry } from '../status/requestStatus'
vi.mock('../log', () => ({ addLog: vi.fn() }))
afterEach(() => { stopStatusTimer(); requestStatuses.set(new Map()) })
const entry = () => get(requestStatuses).get('test:output')!
describe('output lifecycle', () => {
    it('stays active during slow module hooks and save, completing only after save', () => {
        const flow = beginOutputLifecycle('test', 'origin-chat', 'bot', true, false)
        flow.processing()
        expect(recomputeEntry(entry(), Date.now() + 60_000).phase).toBe('postprocessing')
        flow.saving()
        expect(entry().phase).toBe('saving')
        expect(entry().endedAt).toBeUndefined()
        flow.saved()
        flow.finish(false)
        expect(entry().phase).toBe('done')
        expect(entry().chatId).toBe('origin-chat')
    })
    it('does not report success when a hook or persistence fails', () => {
        const flow = beginOutputLifecycle('test', 'origin-chat', 'bot', true, false)
        flow.saving()
        flow.finish(false)
        expect(entry().phase).toBe('failed')
    })
    it('distinguishes cancellation from successful processing', () => {
        const flow = beginOutputLifecycle('test', 'origin-chat', 'bot', true, true)
        flow.finish(true)
        expect(entry().phase).toBe('aborted')
    })
    it('respects disabled status UI', () => {
        const flow = beginOutputLifecycle('test', 'origin-chat', 'bot', false, false)
        flow.processing(); flow.saving(); flow.saved(); flow.finish(false)
        expect(get(requestStatuses).size).toBe(0)
    })
})
