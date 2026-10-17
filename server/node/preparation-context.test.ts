import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { buildPreparationContext } = createRequire(import.meta.url)('./preparation-context.cjs')
describe('server preparation context', () => {
    const fixture = () => ({ characters: [{ chaId: 'a', name: 'A', modules: ['local'], triggerscript: [] }], enabledModules: ['global'],
        modules: [{ id: 'global', name: 'G' }, { id: 'local', name: 'L', trigger: [{}] }, { id: 'other', name: 'Other' }],
        apiKey: 'secret', modelPresets: [{ key: 'secret2' }], maxContext: 1000 })
    it('resolves only the originating chat and active modules, independent of selection', () => {
        const db = fixture(); const chat = { id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }
        const result = buildPreparationContext(db, chat, 'a', 'generation')
        expect(result.context.modules.map((m: any) => m.id)).toEqual(['global', 'local'])
        expect(result.context.capabilities.waitingForAdapter).toContain('lua-or-trigger-context')
        expect(JSON.stringify(result)).not.toContain('secret')
    })
    it('freezes history and settings and hashes content deterministically', () => {
        const db = fixture(); const chat = { id: 'chat-a', message: [{ data: 'before' }] }
        const first = buildPreparationContext(db, chat, 'a', 'generation')
        expect(buildPreparationContext(db, chat, 'a', 'generation').fingerprint).toBe(first.fingerprint)
        chat.message[0].data = 'after'; db.maxContext = 2000
        expect(first.context.chat.message[0].data).toBe('before')
        expect(first.context.budget.context).toBe(1000)
        expect(buildPreparationContext(db, chat, 'a', 'generation').fingerprint).not.toBe(first.fingerprint)
    })
    it('does not silently claim native execution of unsupported module/prompt stages', () => {
        expect(buildPreparationContext(fixture(), { id: 'c', message: [] }, 'a', 'g').context.capabilities.waitingForAdapter).toContain('legacy-prompt-assembler')
    })
})
