import { expect, it } from 'vitest'
import { pendingArgonIllustrations } from './illustrationRecovery'
const slot = (body: string) => `⟪nai_set⟫${body}⟪/nai_set⟫`
const encoded = (body: string) => slot(`⟪argon_data_v1⟫${Buffer.from(body).toString('hex')}⟪/argon_data_v1⟫`)
it('counts valid raw and protected pending slots, without reading status markup', () => {
    expect(pendingArgonIllustrations('<status>HP:100</status>'+slot('{"prompt":"test"}')+encoded('{"prompt":"한글"}'))).toBe(2)
})
it('does not retry generated galleries hidden in the encoded payload', () => {
    expect(pendingArgonIllustrations(encoded('{"prompt":"test"}\n⟪argon_gallery_v1⟫{"images":["{{inlay::abc-123}}"],"selected":1}⟪/argon_gallery_v1⟫'))).toBe(0)
})
it('ignores malformed and partial slots instead of guessing a request', () => {
    expect(pendingArgonIllustrations(slot('not json')+'⟪nai_set⟫{"prompt":"test"}')).toBe(0)
})
