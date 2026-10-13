// Country and state under a subpoint. Boundaries are simplified Natural Earth
// admin-1 polygons, with a coarser country outline where a state is missing.

import places from '../assets/places.json'

let regions = null
let countries = null

function decodeRings(encoded) {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    const view = new DataView(bytes.buffer)
    let offset = 0
    const ringCount = view.getUint16(offset, true)
    offset += 2
    const rings = []
    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const count = view.getUint16(offset, true)
        offset += 2
        let lon = 0
        let lat = 0
        const ring = []
        for (let point = 0; point < count; point += 1) {
            lon += view.getInt16(offset, true)
            offset += 2
            lat += view.getInt16(offset, true)
            offset += 2
            ring.push([lon / 100, lat / 100])
        }
        if (ring.length >= 3) {
            rings.push(ring)
        }
    }

    return rings
}

function compile(rows, hasState) {
    return rows.map((row) => {
        const encoded = row[row.length - 1]
        const area = row[row.length - 2]
        const box = row.slice(hasState ? 2 : 1, hasState ? 6 : 5)

        return {
            country: hasState ? row[0] : row[0],
            state: hasState ? row[1] : -1,
            box,
            area,
            rings: decodeRings(encoded),
        }
    })
}

function prepare() {
    if (regions) {
        return
    }
    regions = compile(places.regions, true)
    countries = compile(places.countries, false)
}

function ringHit(lon, lat, ring) {
    let inside = false
    let previous = ring.length - 1
    for (let index = 0; index < ring.length; index += 1) {
        const point = ring[index]
        const yi = point[1]
        const yj = ring[previous][1]
        if ((yi > lat) !== (yj > lat)) {
            const xi = point[0]
            const xj = ring[previous][0]
            const cross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi
            if (lon < cross) {
                inside = !inside
            }
        }
        previous = index
    }

    return inside
}

function contains(entry, lat, lon) {
    const tests = [lon]
    if (entry.box[2] > 180 || entry.box[0] < -180) {
        tests.push(lon + 360, lon - 360)
    }
    for (let index = 0; index < tests.length; index += 1) {
        const testLon = tests[index]
        if (testLon < entry.box[0] || testLon > entry.box[2] || lat < entry.box[1] || lat > entry.box[3]) {
            continue
        }
        if (entry.rings.some((ring) => ringHit(testLon, lat, ring))) {
            return true
        }
    }

    return false
}

function find(entries, lat, lon) {
    let best = null
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!contains(entry, lat, lon)) {
            continue
        }
        if (!best || entry.area < best.area) {
            best = entry
        }
    }

    return best
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{ country: string | null, state: string | null }}
 */
export function locate(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { country: null, state: null }
    }
    prepare()
    const region = find(regions, lat, lon)
    if (region) {
        const country = places.names[region.country] || null
        const state = places.names[region.state] || null

        return {
            country,
            state: state && country && state.localeCompare(country, undefined, { sensitivity: 'accent' }) === 0 ? null : state,
        }
    }
    const country = find(countries, lat, lon)
    if (country) {
        return { country: places.names[country.country] || null, state: null }
    }

    return { country: null, state: null }
}

export function plateLabel(value) {
    if (!value) {
        return '--'
    }
    const text = String(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase()

    return text || '--'
}
