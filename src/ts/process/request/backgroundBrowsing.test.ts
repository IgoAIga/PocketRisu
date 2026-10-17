import { afterEach, describe, expect, it, vi } from 'vitest'
import { canBrowseServerJob, forgetBrowsableJob, hasBrowsableJob, lockJobPostprocessing, registerBrowsableJob, saveThenClaimJob, waitForOriginChat } from './backgroundBrowsing'
afterEach(() => { forgetBrowsableJob('test'); vi.useRealTimers() })
describe('server request browsing', () => {
    it('allows browsing only before postprocessing', () => {
        registerBrowsableJob('test', async () => {})
        expect(canBrowseServerJob()).toBe(true)
        lockJobPostprocessing('test')
        expect(canBrowseServerJob()).toBe(false)
    })
    it('keeps the server journal recoverable if saving fails', async () => {
        const claim = vi.fn(async () => {})
        registerBrowsableJob('test', claim)
        await expect(saveThenClaimJob('test', async () => { throw Error('offline') })).rejects.toThrow('offline')
        expect(claim).not.toHaveBeenCalled()
        expect(hasBrowsableJob('test')).toBe(true)
        const events: string[] = []
        registerBrowsableJob('test', async () => { events.push('claim') })
        await saveThenClaimJob('test', async () => { events.push('save') })
        expect(events).toEqual(['save', 'claim'])
        expect(hasBrowsableJob('test')).toBe(false)
    })
    it('waits for the originating chat and cleans up on abort', async () => {
        vi.useFakeTimers()
        let origin = false
        const controller = new AbortController()
        const waiting = waitForOriginChat(() => origin, controller.signal)
        origin = true
        await vi.advanceTimersByTimeAsync(100)
        expect(await waiting).toBe(true)
        const aborted = waitForOriginChat(() => false, controller.signal)
        controller.abort()
        expect(await aborted).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })
})
