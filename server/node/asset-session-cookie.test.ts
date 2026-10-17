import { describe, expect, it } from 'vitest'
import cookies from './asset-session-cookie.cjs'

describe('independent installation asset authentication', () => {
    it('keeps identity across restart and separates installations sharing a host', () => {
        expect(cookies.assetSessionCookieName('lab')).toBe(cookies.assetSessionCookieName('lab'))
        expect(cookies.assetSessionCookieName('lab')).not.toBe(cookies.assetSessionCookieName('main'))
    })
    it('selects its own cookie from a browser header containing all installations', () => {
        const main = cookies.assetSessionCookieName('main')
        const lab = cookies.assetSessionCookieName('lab')
        for (const header of [
            `risu-session=legacy; ${main}=main-token; ${lab}=lab-token`,
            `${lab}=lab-token; ${main}=main-token; risu-session=legacy`,
        ]) {
            expect(cookies.readAssetSessionCookie(header, main)).toBe('main-token')
            expect(cookies.readAssetSessionCookie(header, lab)).toBe('lab-token')
        }
    })
    it('does not accept another installation or the shared legacy cookie', () => {
        const lab = cookies.assetSessionCookieName('lab')
        expect(cookies.readAssetSessionCookie('risu-session=legacy', lab)).toBeNull()
        expect(cookies.readAssetSessionCookie(`${lab}-other=wrong`, lab)).toBeNull()
        expect(cookies.readAssetSessionCookie(undefined, lab)).toBeNull()
    })
})
