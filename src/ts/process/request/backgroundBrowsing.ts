// Every tracked main job keeps its journal until its chat is persisted.
// Only buffered jobs may release the navigation lock; streaming still uses
// the selected chat during output processing.
const jobs = new Map<string, { browsing: boolean; claim: () => Promise<void> }>()

export function registerBrowsableJob(id: string, claim: () => Promise<void>, browsing = true): void {
    jobs.set(id, { browsing, claim })
}
export function canBrowseServerJob(): boolean {
    return [...jobs.values()].some(job => job.browsing)
}
export function hasBrowsableJob(id: string): boolean { return jobs.has(id) }
export function lockJobPostprocessing(id: string): void {
    const job = jobs.get(id)
    if (job) job.browsing = false
}
export function forgetBrowsableJob(id: string): void { jobs.delete(id) }
export async function saveThenClaimJob(id: string, save: () => Promise<void>): Promise<void> {
    const job = jobs.get(id)
    if (!job) return
    await save()
    await job.claim()
    jobs.delete(id)
}

export async function waitForOriginChat(isOrigin: () => boolean, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    if (isOrigin()) return true
    return new Promise(resolve => {
        const finish = (ready: boolean) => {
            clearInterval(timer)
            signal.removeEventListener('abort', abort)
            resolve(ready)
        }
        const abort = () => finish(false)
        const timer = setInterval(() => { if (isOrigin()) finish(true) }, 100)
        signal.addEventListener('abort', abort, { once: true })
    })
}
