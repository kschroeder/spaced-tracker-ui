export const THEMES = ['phosphor', 'green', 'amber', 'white']

export const MODES = [
    { id: 'catalog', label: 'CATALOG', requestClass: 'satcat' },
    { id: 'elements', label: 'ELEMENTS', requestClass: 'gp' },
    { id: 'decay', label: 'DECAY', requestClass: 'decay' },
    { id: 'reentry', label: 'REENTRY', requestClass: 'tip' },
]

export const OBJECT_CLASSES = [
    { id: 'ALL', label: 'ALL' },
    { id: 'PAY', label: 'PAY' },
    { id: 'R/B', label: 'R/B' },
    { id: 'DEB', label: 'DEB' },
]

export const REGIMES = ['ALL', 'LEO', 'MEO', 'GEO', 'HEO']

export const STATUSES = ['ALL', 'ON ORBIT', 'DECAYED', 'HISTORICAL']

export const PAGE_SIZE = 50

const OBJECT_TYPE = {
    PAY: 'PAYLOAD',
    'R/B': 'ROCKET BODY',
    DEB: 'DEBRIS',
}

// Contact status is derived. Only satcat has DECAY and CURRENT, so the
// other request classes filter the rows they already received.
const SATCAT_STATUS = {
    'ON ORBIT': { DECAY: 'null-val', CURRENT: 'Y' },
    DECAYED: { DECAY: '<>null-val' },
    HISTORICAL: { CURRENT: 'N', DECAY: 'null-val' },
}

// LAUNCH and SITE exist on satcat. gp, decay, and tip reject those fields.

export function nextTheme(current) {
    const index = THEMES.indexOf(current)

    return THEMES[(index + 1) % THEMES.length] ?? THEMES[0]
}

export function catalogRequest({ mode, objectClass, search, orbit, status, site = 'ALL', page = 1 }) {
    const selected = MODES.find((item) => item.id === mode) ?? MODES[0]
    const where = {}
    if (OBJECT_TYPE[objectClass]) {
        where.OBJECT_TYPE = OBJECT_TYPE[objectClass]
    }
    const term = String(search ?? '').trim()
    if (term !== '') {
        where.OBJECT_NAME = `~~${term}`
    }
    if (selected.requestClass === 'satcat' && SATCAT_STATUS[status]) {
        Object.assign(where, SATCAT_STATUS[status])
    }
    const code = typeof site === 'string' ? site.trim() : ''
    if (selected.requestClass === 'satcat' && code !== '' && code !== 'ALL') {
        where.SITE = code
    }
    const body = {
        class: selected.requestClass,
        where,
        limit: PAGE_SIZE,
    }
    if (selected.requestClass === 'satcat') {
        body.order_by = [{ field: 'LAUNCH', direction: 'desc' }]
    }
    body.metadata = true
    if (orbit && orbit !== 'ALL') {
        body.orbit = orbit
    }
    const pageNumber = Number(page)
    if (Number.isInteger(pageNumber) && pageNumber > 1) {
        body.offset = (pageNumber - 1) * PAGE_SIZE
    }

    return body
}

export function launchSiteRequest() {
    return {
        class: 'launch_site',
        where: {},
        limit: 500,
        order_by: [{ field: 'LAUNCH_SITE', direction: 'asc' }],
    }
}

export function normalizeLaunchSites(records) {
    const rows = Array.isArray(records) ? records : []
    const seen = new Set()
    const sites = []
    rows.forEach((row) => {
        if (!row || typeof row !== 'object') {
            return
        }
        const code = String(row.SITE_CODE ?? row.SITE ?? '').trim()
        const name = String(row.LAUNCH_SITE ?? '').trim()
        if (code === '' || name === '' || seen.has(code)) {
            return
        }
        seen.add(code)
        sites.push({ code, name })
    })
    sites.sort((left, right) => {
        if (left.name === right.name) {
            return left.code < right.code ? -1 : left.code > right.code ? 1 : 0
        }

        return left.name < right.name ? -1 : 1
    })

    return sites
}

export function filterIndex(contacts, records, status, site) {
    const rows = Array.isArray(contacts) ? contacts : []
    const source = Array.isArray(records) ? records : []
    const statusAll = !status || status === 'ALL'
    const code = typeof site === 'string' ? site.trim() : ''
    const siteAll = code === '' || code === 'ALL'
    if (statusAll && siteAll) {
        return { contacts: rows, records: source }
    }
    const nextContacts = []
    const nextRecords = []
    rows.forEach((contact, index) => {
        if (!statusAll && (!contact || contact.status !== status)) {
            return
        }
        if (!siteAll) {
            const record = source[index]
            const recordCode = record && typeof record === 'object'
                ? String(record.SITE ?? record.SITE_CODE ?? '').trim()
                : ''
            if (recordCode !== code) {
                return
            }
        }
        nextContacts.push(contact)
        nextRecords.push(source[index])
    })

    return { contacts: nextContacts, records: nextRecords }
}

export function formatPerigee(value) {
    if (value === null || value === undefined || value === '') {
        return '--'
    }
    const number = Number(value)
    if (Number.isNaN(number)) {
        return '--'
    }

    return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export function formatField(value) {
    if (value === null || value === undefined) {
        return '--'
    }
    if (typeof value === 'number') {
        return Number.isNaN(value) ? '--' : String(value)
    }
    if (typeof value === 'boolean') {
        return value ? 'Y' : 'N'
    }
    if (typeof value === 'string') {
        return value.trim() === '' ? '--' : value
    }
    try {
        return JSON.stringify(value)
    } catch {
        return '--'
    }
}

/**
 * @param {Record<string, unknown> | null | undefined} record
 */
export function recordFields(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return []
    }

    return Object.entries(record).map(([key, value]) => ({
        key,
        label: key.replace(/_/g, ' '),
        value: formatField(value),
    }))
}

/**
 * @param {{ id?: string, name?: string, designation?: string, class?: string, orbit?: string, perigee?: unknown, country?: string, status?: string } | null | undefined} contact
 */
export function contactFields(contact) {
    if (!contact) {
        return []
    }
    const rows = [
        ['NORAD', contact.id],
        ['NAME', contact.name],
        ['INTLDES', contact.designation],
        ['CLASS', contact.class],
        ['ORBIT', contact.orbit],
        ['PERIGEE', formatPerigee(contact.perigee)],
        ['COUNTRY', contact.country],
        ['STATUS', contact.status],
    ]

    return rows.map(([key, value]) => ({
        key,
        label: key,
        value: value === null || value === undefined || String(value).trim() === '' ? '--' : String(value),
    }))
}
