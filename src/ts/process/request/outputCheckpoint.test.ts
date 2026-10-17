import { describe, expect, it, vi } from 'vitest'
import { runCheckpointedOutput, type OutputCheckpoint } from './outputCheckpoint'

describe('durable output checkpoints', () => {
    it('claims each stage before effects and saves completion before the next', async () => {
        let state: OutputCheckpoint = { next: 0, state: 'pending', jobId: 'job' }
        const events: string[] = []
        await runCheckpointedOutput(() => state, s => { state = s }, async stage => { events.push(`save:${stage ?? 'done'}`) }, [
            async () => { events.push('effect:0') }, async () => { events.push('effect:1') },
        ])
        expect(events).toEqual(['save:0', 'effect:0', 'save:done', 'save:1', 'effect:1', 'save:done'])
        expect(state).toEqual({ next: 2, state: 'done', jobId: 'job' })
    })
    it('resumes only unstarted stages after a completed checkpoint', async () => {
        let state: OutputCheckpoint = { next: 1, state: 'pending', jobId: 'job' }
        const first = vi.fn(), second = vi.fn()
        await runCheckpointedOutput(() => state, s => { state = s }, async () => {}, [first, second])
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledOnce()
    })
    it.each(['running', 'blocked', 'done'] as const)('never replays %s work', async status => {
        let state: OutputCheckpoint = { next: 0, state: status, jobId: 'job' }
        const effect = vi.fn()
        await runCheckpointedOutput(() => state, s => { state = s }, async () => {}, [effect])
        expect(effect).not.toHaveBeenCalled()
    })
    it('does not execute when the server denies a duplicate claim', async () => {
        let state: OutputCheckpoint = { next: 0, state: 'pending', jobId: 'job' }
        const effect = vi.fn()
        await expect(runCheckpointedOutput(() => state, s => { state = s }, async () => { throw Error('409') }, [effect])).rejects.toThrow('409')
        expect(effect).not.toHaveBeenCalled()
        expect(state.state).toBe('blocked')
    })
    it('does not repeat an external effect after completion save fails', async () => {
        let state: OutputCheckpoint = { next: 0, state: 'pending', jobId: 'job' }
        const effect = vi.fn()
        const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(Error('offline'))
        await expect(runCheckpointedOutput(() => state, s => { state = s }, save, [effect])).rejects.toThrow()
        await runCheckpointedOutput(() => state, s => { state = s }, save, [effect])
        expect(effect).toHaveBeenCalledOnce()
        expect(state.state).toBe('blocked')
    })
})
