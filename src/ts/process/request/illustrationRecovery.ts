/** Inspect only the illustration module's own envelopes, never prose/status tags. */
export function pendingArgonIllustrations(text: string): number {
    let pending = 0
    for (const match of text.matchAll(/⟪nai\s?_set⟫([\s\S]*?)⟪\/nai\s?_set⟫/g)) {
        try {
            let inner = match[1].trim()
            const encoded = inner.match(/^⟪argon_data_v1⟫([0-9a-f]+)⟪\/argon_data_v1⟫$/i)
            if (encoded) {
                if (encoded[1].length % 2) continue
                inner = new TextDecoder().decode(Uint8Array.from(encoded[1].match(/../g)!, h => parseInt(h, 16)))
            }
            const gallery = inner.match(/⟪argon_gallery_v1⟫([\s\S]*?)⟪\/argon_gallery_v1⟫\s*$/)
            if (gallery) {
                const images = JSON.parse(gallery[1]).images
                if (Array.isArray(images) && images.some(v => typeof v === 'string' && /^\{\{inlay::[\w-]+\}\}$/.test(v))) continue
                inner = inner.slice(0, gallery.index).trim()
            }
            if (/⟪nai_img⟫\s*\{\{inlay::[\w-]+\}\}\s*⟪\/nai_img⟫/.test(inner)) continue
            const data = JSON.parse(inner)
            if (data && typeof data === 'object' && !Array.isArray(data)) pending++
        } catch { /* Not a complete module slot; don't infer an image request. */ }
    }
    return pending
}
