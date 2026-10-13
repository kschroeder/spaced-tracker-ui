import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogScreen from './components/CatalogScreen.vue'
import { catalogRequest, contactFields, filterIndex, formatPerigee, launchSiteRequest, nextTheme, normalizeLaunchSites, recordFields } from './lib/catalog.js'

const contacts = [
    {
        id: '25544',
        name: 'ISS (ZARYA)',
        designation: '1998-067A',
        class: 'PAY',
        orbit: 'LEO',
        perigee: 418,
        country: 'US',
        status: 'ON ORBIT',
    },
    {
        id: '20580',
        name: 'HUBBLE',
        designation: '1990-037B',
        class: 'PAY',
        orbit: 'LEO',
        perigee: 535,
        country: 'US',
        status: 'ON ORBIT',
    },
]

const records = [
    {
        NORAD_CAT_ID: 25544,
        OBJECT_NAME: 'ISS (ZARYA)',
        PERIOD: 92.68,
        INCLINATION: 51.64,
        PERIGEE: 418,
        EPOCH: '2026-01-01T00:00:00',
        DECAY: null,
    },
    {
        NORAD_CAT_ID: 20580,
        OBJECT_NAME: 'HUBBLE',
        INTLDES: '1990-037B',
        PERIOD: 95.42,
        INCLINATION: 28.47,
        DECAY: null,
    },
]

beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
        if (String(url).includes('/health')) {
            return { ok: true, json: async () => ({ status: 'ok', mode: 'demo', auth: 'open' }) }
        }
        return {
            ok: true,
            json: async () => ({
                class: 'satcat',
                contacts,
                records,
                count: contacts.length,
                echo: options.body,
            }),
        }
    }))
})

describe('catalog request', () => {
    it('cycles the standard CRT colors and builds a filtered query', () => {
        expect(nextTheme('phosphor')).toBe('green')
        expect(nextTheme('white')).toBe('phosphor')
        expect(formatPerigee(null)).toBe('--')
        expect(recordFields({ OBJECT_NAME: 'HUBBLE', DECAY: null, SITE: '' })).toEqual([
            { key: 'OBJECT_NAME', label: 'OBJECT NAME', value: 'HUBBLE' },
            { key: 'DECAY', label: 'DECAY', value: '--' },
            { key: 'SITE', label: 'SITE', value: '--' },
        ])
        expect(recordFields(null)).toEqual([])
        expect(contactFields(contacts[1]).map((field) => field.value)).toContain('1990-037B')
        expect(catalogRequest({
            mode: 'elements',
            objectClass: 'DEB',
            search: 'SL-16',
            orbit: 'LEO',
            status: 'DECAYED',
        })).toEqual({
            class: 'gp',
            where: { OBJECT_TYPE: 'DEBRIS', OBJECT_NAME: '~~SL-16' },
            limit: 50,
            metadata: true,
            orbit: 'LEO',
        })
        const elementsPage = catalogRequest({
            mode: 'elements',
            objectClass: 'ALL',
            search: '',
            orbit: 'ALL',
            status: 'ALL',
            site: 'AFETR',
            page: 3,
        })
        expect(elementsPage).toEqual({
            class: 'gp',
            where: {},
            limit: 50,
            metadata: true,
            offset: 100,
        })
        expect(elementsPage.where).not.toHaveProperty('SITE')
        expect(elementsPage).not.toHaveProperty('order_by')
        expect(catalogRequest({
            mode: 'catalog',
            objectClass: 'ALL',
            search: '',
            orbit: 'ALL',
            status: 'ON ORBIT',
        })).toEqual({
            class: 'satcat',
            where: { DECAY: 'null-val', CURRENT: 'Y' },
            limit: 50,
            order_by: [{ field: 'LAUNCH', direction: 'desc' }],
            metadata: true,
        })
        expect(catalogRequest({
            mode: 'catalog',
            objectClass: 'PAY',
            search: '',
            orbit: 'GEO',
            status: 'HISTORICAL',
        })).toEqual({
            class: 'satcat',
            where: { OBJECT_TYPE: 'PAYLOAD', CURRENT: 'N', DECAY: 'null-val' },
            limit: 50,
            order_by: [{ field: 'LAUNCH', direction: 'desc' }],
            metadata: true,
            orbit: 'GEO',
        })
        expect(catalogRequest({
            mode: 'catalog',
            objectClass: 'ALL',
            search: '',
            orbit: 'ALL',
            status: 'ALL',
            site: 'AFETR',
            page: 1,
        })).toEqual({
            class: 'satcat',
            where: { SITE: 'AFETR' },
            limit: 50,
            order_by: [{ field: 'LAUNCH', direction: 'desc' }],
            metadata: true,
        })
        expect(catalogRequest({
            mode: 'catalog',
            objectClass: 'ALL',
            search: '',
            orbit: 'ALL',
            status: 'DECAYED',
            site: 'AFETR',
            page: 2,
        })).toEqual({
            class: 'satcat',
            where: { DECAY: '<>null-val', SITE: 'AFETR' },
            limit: 50,
            order_by: [{ field: 'LAUNCH', direction: 'desc' }],
            metadata: true,
            offset: 50,
        })
        expect(launchSiteRequest()).toEqual({
            class: 'launch_site',
            where: {},
            limit: 500,
            order_by: [{ field: 'LAUNCH_SITE', direction: 'asc' }],
        })
        expect(normalizeLaunchSites([
            { SITE_CODE: 'AFETR', LAUNCH_SITE: 'CAPE CANAVERAL' },
            { SITE_CODE: 'AFETR', LAUNCH_SITE: 'CAPE CANAVERAL' },
            { SITE_CODE: 'TTMTR', LAUNCH_SITE: 'BAIKONUR' },
            { SITE_CODE: '', LAUNCH_SITE: 'UNKNOWN' },
            { LAUNCH_SITE: 'NO CODE' },
        ])).toEqual([
            { code: 'TTMTR', name: 'BAIKONUR' },
            { code: 'AFETR', name: 'CAPE CANAVERAL' },
        ])
        expect(filterIndex(contacts, records, 'ON ORBIT').contacts.map((contact) => contact.id)).toEqual(['25544', '20580'])
        expect(filterIndex(
            [...contacts, { id: '7530', status: 'DECAYED' }],
            [...records, { NORAD_CAT_ID: 7530 }],
            'DECAYED',
        )).toEqual({
            contacts: [{ id: '7530', status: 'DECAYED' }],
            records: [{ NORAD_CAT_ID: 7530 }],
        })
        expect(filterIndex(contacts, records, 'ALL').records).toBe(records)
        const sourced = [
            { NORAD_CAT_ID: 25544, SITE: 'AFETR' },
            { NORAD_CAT_ID: 20580, SITE: 'TTMTR' },
        ]
        expect(filterIndex(contacts, sourced, 'ON ORBIT', 'TTMTR')).toEqual({
            contacts: [contacts[1]],
            records: [sourced[1]],
        })
        expect(filterIndex(contacts, sourced, 'ALL', 'ALL').records).toBe(sourced)
    })

    it('keeps scanlines static when the operator prefers reduced motion', () => {
        const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
        expect(css).toContain('prefers-reduced-motion')
        expect(css).toContain('is-inspect')
        expect(css).toContain('2lh')
        expect(css).toContain('max-width: 800px')
        expect(css).toContain('max-width: 520px')
        expect(css).toContain('table-head-scroll')
        expect(css).toContain('font-size: 32px')
        expect(css).toContain('site-choices')
        expect(css).toContain('max-height: 9.5rem')
        expect(css).not.toMatch(/weapon/i)
    })
})

describe('catalog screen', () => {
    it('renders the orbital catalog, selects a contact, and toggles the CRT color', async () => {
        const wrapper = mount(CatalogScreen)
        await flushPromises()

        expect(wrapper.text()).toContain('SPACED TRACKER')
        expect(wrapper.text()).toContain('ORBITAL CATALOG SYSTEM')
        expect(wrapper.text()).toContain('LINK DEMO')
        expect(wrapper.text()).not.toContain('FORMAT')
        expect(wrapper.text()).not.toContain('LINK STATUS')
        expect(wrapper.find('.table-head-scroll thead').exists()).toBe(true)
        expect(wrapper.find('.table-wrap thead').classes()).toContain('clip-head')
        expect(wrapper.text()).not.toMatch(/weapon/i)
        expect(wrapper.text()).toContain('ISS (ZARYA)')
        expect(wrapper.find('[data-theme="phosphor"]').exists()).toBe(true)

        const rows = wrapper.findAll('tbody tr')
        await rows[1].trigger('click')
        await flushPromises()
        expect(rows[1].classes()).toContain('is-selected')
        expect(wrapper.get('.bezel').classes()).toContain('is-inspect')
        expect(wrapper.get('.bezel').classes()).toContain('is-locked')
        const file = wrapper.get('.dossier')
        expect(file.text()).toContain('SATCAT FILE')
        expect(file.text()).toContain('OBJECT NAME')
        expect(file.text()).toContain('95.42')
        expect(file.text()).toContain('INCLINATION')
        expect(file.text()).toContain('1990-037B')
        expect(file.text()).toContain('DECAY')
        expect(wrapper.get('.plate').text()).toContain('SUBPOINT')
        expect(wrapper.get('.plate').text()).toContain('NO FIX')

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
        await flushPromises()
        expect(wrapper.get('.dossier').text()).toContain('92.68')
        const plate = wrapper.get('.plate')
        expect(plate.text()).toContain('SUBPOINT')
        expect(plate.text()).toContain('ALT KM')
        expect(plate.text()).toMatch(/\d+\.\d{2}\s+[NS]/)
        expect(plate.text()).not.toContain('NO FIX')

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await flushPromises()
        expect(wrapper.find('.dossier').exists()).toBe(false)
        expect(wrapper.get('.bezel').classes()).not.toContain('is-locked')
        expect(wrapper.text()).toContain('ISS (ZARYA)')
        expect(wrapper.text()).toContain('HUBBLE')

        await wrapper.get('footer button').trigger('click')
        expect(wrapper.find('[data-theme="green"]').exists()).toBe(true)

        await wrapper.get('button[aria-pressed="false"]').trigger('click')
        await flushPromises()
        const bodies = vi.mocked(fetch).mock.calls
            .map((call) => call[1]?.body)
            .filter((body) => typeof body === 'string')
        expect(bodies.some((body) => body.includes('"class":"gp"') || body.includes('DEBRIS') || body.includes('PAYLOAD'))).toBe(true)
        wrapper.unmount()
    })

    it('filters the index by contact status', async () => {
        const mixed = [
            ...contacts,
            {
                id: '7530',
                name: 'SKYLAB',
                designation: '1973-027A',
                class: 'PAY',
                orbit: 'LEO',
                perigee: null,
                country: 'US',
                status: 'DECAYED',
            },
        ]
        const mixedRecords = [
            ...records,
            { NORAD_CAT_ID: 7530, OBJECT_NAME: 'SKYLAB', DECAY: '1979-07-11' },
        ]
        vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
            if (String(url).includes('/health')) {
                return { ok: true, json: async () => ({ status: 'ok', mode: 'demo', auth: 'open' }) }
            }
            return {
                ok: true,
                json: async () => ({
                    class: 'satcat',
                    contacts: mixed,
                    records: mixedRecords,
                    count: mixed.length,
                    echo: options.body,
                }),
            }
        }))

        const wrapper = mount(CatalogScreen)
        await flushPromises()
        const button = wrapper.findAll('button').find((item) => item.text().replace(/\s+/g, ' ').trim() === 'DECAYED')
        await button.trigger('click')
        await flushPromises()

        expect(wrapper.get('.table-wrap').text()).toContain('SKYLAB')
        expect(wrapper.get('.table-wrap').text()).not.toContain('ISS (ZARYA)')
        expect(wrapper.get('.table-wrap').text()).not.toContain('HUBBLE')
        const bodies = vi.mocked(fetch).mock.calls
            .map((call) => call[1]?.body)
            .filter((body) => typeof body === 'string')
        expect(bodies.at(-1)).toContain('"class":"satcat"')
        expect(bodies.at(-1)).toContain('"DECAY":"<>null-val"')
        expect(bodies.at(-1)).not.toContain('format')

        const elements = wrapper.findAll('button').find((item) => item.text().replace(/\s+/g, ' ').trim() === 'ELEMENTS')
        await elements.trigger('click')
        await flushPromises()
        const latest = vi.mocked(fetch).mock.calls.map((call) => call[1]?.body).filter((body) => typeof body === 'string').at(-1)
        expect(latest).toContain('"class":"gp"')
        expect(latest).not.toContain('DECAY')
        expect(latest).not.toContain('CURRENT')
        expect(wrapper.get('.table-wrap').text()).toContain('SKYLAB')
        expect(wrapper.get('.table-wrap').text()).not.toContain('HUBBLE')

        const all = wrapper.findAll('button').find((item) => item.text().replace(/\s+/g, ' ').trim() === 'ALL' && item.element.closest('section')?.querySelector('h2')?.textContent === 'STATUS')
        await all.trigger('click')
        await flushPromises()
        expect(wrapper.get('.table-wrap').text()).toContain('ISS (ZARYA)')
        expect(wrapper.get('.table-wrap').text()).toContain('SKYLAB')
        wrapper.unmount()
    })

    it('filters by launch site name and pages the index', async () => {
        const pagedRecords = [
            { ...records[0], SITE: 'AFETR', LAUNCH: '1998-11-20' },
            { ...records[1], SITE: 'TTMTR', LAUNCH: '1990-04-24' },
        ]
        vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
            if (String(url).includes('/health')) {
                return { ok: true, json: async () => ({ status: 'ok', mode: 'demo', auth: 'open' }) }
            }
            const body = options.body ? JSON.parse(options.body) : {}
            if (body.class === 'launch_site') {
                return {
                    ok: true,
                    json: async () => ({
                        records: [
                            { SITE_CODE: 'AFETR', LAUNCH_SITE: 'CAPE CANAVERAL' },
                            { SITE_CODE: 'AFETR', LAUNCH_SITE: 'CAPE CANAVERAL' },
                            { SITE_CODE: 'TTMTR', LAUNCH_SITE: 'BAIKONUR' },
                        ],
                    }),
                }
            }
            return {
                ok: true,
                json: async () => ({
                    class: body.class,
                    contacts,
                    records: pagedRecords,
                    metadata: { Total: '120' },
                    count: contacts.length,
                }),
            }
        }))

        const wrapper = mount(CatalogScreen)
        await flushPromises()
        expect(wrapper.find('.site-choices').findAll('button').map((button) => button.text())).toEqual([
            'ALL',
            'BAIKONUR',
            'CAPE CANAVERAL',
        ])
        expect(wrapper.findAll('button').filter((button) => button.text() === 'CAPE CANAVERAL')).toHaveLength(1)
        const posted = () => vi.mocked(fetch).mock.calls
            .map((call) => call[1]?.body)
            .filter((body) => typeof body === 'string')
        const prev = wrapper.findAll('footer button').find((button) => button.text() === 'PREV')
        const next = wrapper.findAll('footer button').find((button) => button.text() === 'NEXT')
        expect(prev.element.disabled).toBe(true)
        expect(next.element.disabled).toBe(false)
        expect(wrapper.text()).toContain('PAGE 01/03')
        expect(wrapper.text()).toContain('120 MATCHES')
        expect(posted().some((body) => body.includes('"field":"LAUNCH"') && body.includes('"direction":"desc"'))).toBe(true)

        await wrapper.find('.site-choices').findAll('button').find((button) => button.text() === 'CAPE CANAVERAL').trigger('click')
        await flushPromises()
        const filtered = posted().at(-1)
        expect(filtered).toContain('"SITE":"AFETR"')
        expect(filtered).toContain('"field":"LAUNCH"')
        expect(filtered).not.toContain('offset')
        expect(wrapper.get('.table-wrap').text()).toContain('ISS (ZARYA)')
        expect(wrapper.get('.table-wrap').text()).not.toContain('HUBBLE')

        await next.trigger('click')
        await flushPromises()
        expect(posted().at(-1)).toContain('"offset":50')
        expect(posted().at(-1)).toContain('"SITE":"AFETR"')
        expect(wrapper.text()).toContain('PAGE 02/03')
        expect(prev.element.disabled).toBe(false)

        await prev.trigger('click')
        await flushPromises()
        expect(posted().at(-1)).not.toContain('offset')
        expect(wrapper.text()).toContain('PAGE 01/03')

        const elements = wrapper.findAll('button').find((item) => item.text().replace(/\s+/g, ' ').trim() === 'ELEMENTS')
        await elements.trigger('click')
        await flushPromises()
        const elementsBody = posted().at(-1)
        expect(elementsBody).toContain('"class":"gp"')
        expect(elementsBody).not.toContain('SITE')
        expect(elementsBody).not.toContain('LAUNCH')
        expect(elementsBody).not.toContain('offset')
        wrapper.unmount()
    })

    it('keeps the catalog when the site list fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
            const body = options.body ? JSON.parse(options.body) : {}
            if (String(url).includes('/health')) {
                return { ok: true, json: async () => ({ status: 'ok', mode: 'demo', auth: 'open' }) }
            }
            if (body.class === 'launch_site') {
                return { ok: false, json: async () => ({ detail: 'nope' }) }
            }
            return {
                ok: true,
                json: async () => ({
                    class: 'satcat',
                    contacts,
                    records,
                    metadata: { Total: 2 },
                }),
            }
        }))

        const wrapper = mount(CatalogScreen)
        await flushPromises()
        expect(wrapper.text()).toContain('ISS (ZARYA)')
        expect(wrapper.text()).toContain('LINK DEMO')
        expect(wrapper.text()).toContain('PAGE 01/01')
        expect(wrapper.text()).not.toContain('CAPE CANAVERAL')
        wrapper.unmount()
    })
})
