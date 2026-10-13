import { catalogRequest, launchSiteRequest, normalizeLaunchSites } from './catalog.js'

export async function loadCatalog(state) {
    const healthResponse = await fetch('/api/health')
    if (!healthResponse.ok) {
        throw new Error('Catalog link failed.')
    }
    const health = await healthResponse.json()
    const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(catalogRequest(state)),
    })
    const payload = await response.json().catch(() => ({ detail: 'Catalog request failed.' }))
    if (!response.ok) {
        const detail = typeof payload.detail === 'string' ? payload.detail : 'Catalog request failed.'
        throw new Error(detail)
    }

    return {
        link: health.mode === 'live' ? 'LIVE' : 'DEMO',
        contacts: Array.isArray(payload.contacts) ? payload.contacts : [],
        records: Array.isArray(payload.records) ? payload.records : [],
        fileClass: typeof payload.class === 'string' ? payload.class : '',
        total: matchTotal(payload.metadata),
    }
}

export async function loadLaunchSites() {
    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(launchSiteRequest()),
        })
        if (!response.ok) {
            return []
        }
        const payload = await response.json().catch(() => null)

        return normalizeLaunchSites(payload && Array.isArray(payload.records) ? payload.records : [])
    } catch {
        return []
    }
}

function matchTotal(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return null
    }
    const raw = metadata.Total ?? metadata.total
    if (raw === undefined || raw === null || raw === '') {
        return null
    }
    const number = Number(raw)
    if (!Number.isFinite(number) || number < 0) {
        return null
    }

    return Math.trunc(number)
}
