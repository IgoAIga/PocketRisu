export interface OutputCheckpoint {
    next: number
    state: 'pending' | 'running' | 'done' | 'blocked'
    jobId: string
}

/** Claim before side effects, checkpoint after each stage. Never replay an
 * ambiguous running stage after a reload or network failure. */
export async function runCheckpointedOutput(
    read: () => OutputCheckpoint,
    write: (value: OutputCheckpoint) => void,
    persist: (claimStage?: number) => Promise<void>,
    stages: Array<() => Promise<void>>,
): Promise<void> {
    if (read().state !== 'pending') return
    try {
        while (read().next < stages.length) {
            const state = read()
            const stage = state.next
            write({ ...state, state: 'running' })
            await persist(stage)
            await stages[stage]()
            write({ ...state, next: stage + 1, state: stage + 1 === stages.length ? 'done' : 'pending' })
            await persist()
        }
    } catch (error) {
        write({ ...read(), state: 'blocked' })
        // A failed save must not turn into an automatic side-effect retry.
        try { await persist() } catch { /* retained receipt blocks replay */ }
        throw error
    }
}
