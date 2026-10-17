import { startStatus, markPhase, endStatus } from '../status/requestStatus'
import { addLog } from '../log'

// This tracks output processing only, not later emotion/TTS/auto-continue work.
// Do not replay module hooks on reload: they can have non-idempotent effects.
export function beginOutputLifecycle(generationId: string, chatId: string | undefined, label: string, enabled: boolean, streaming: boolean) {
    const id = `${generationId}:output`
    let saved = false
    const safe = (fn: () => void) => { try { fn() } catch { /* observability cannot break a send */ } }
    const record = (event: string, level: 'info' | 'warning' = 'info') => safe(() => addLog({
        level, source: 'output-lifecycle', message: event,
        description: JSON.stringify({ generationId, chatId }),
    }))
    if (enabled) safe(() => startStatus(id, { kind: 'output', label, chatId, phase: streaming ? 'responding' : 'postprocessing', now: Date.now() }))
    record('Output processing started')
    return {
        processing() {
            if (enabled) safe(() => markPhase(id, 'postprocessing', Date.now()))
            record('Output module hooks started')
        },
        saving() {
            if (enabled) safe(() => markPhase(id, 'saving', Date.now()))
            record('Output save started')
        },
        saved() { saved = true },
        finish(aborted: boolean) {
            const phase = saved ? 'done' : aborted ? 'aborted' : 'failed'
            if (enabled) safe(() => endStatus(id, phase, { now: Date.now() }))
            record(saved ? 'Output saved' : aborted ? 'Output processing interrupted' : 'Output processing failed before save', saved ? 'info' : 'warning')
        },
    }
}
