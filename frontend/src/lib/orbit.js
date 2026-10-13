const SIDEREAL_MINUTES = 1436.07
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function number(value) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
}

function wrapDegrees(value) {
    const turned = ((value % 360) + 360) % 360

    return turned > 180 ? turned - 360 : turned
}

function parseEpoch(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null
    }
    const trimmed = value.trim()
    const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`
    const time = Date.parse(zoned)

    return Number.isFinite(time) ? time : null
}

const TRACK_STEPS = 180

/**
 * A catalog row has inclination and period. An elements row also carries the
 * epoch, node, argument of perigee, and mean anomaly that locate the satellite.
 * Without those angles the node and the anomaly stay zero at epoch.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{ perigee?: unknown } | null | undefined} contact
 */
export function elementsFromRecord(record, contact) {
    const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {}
    const meanMotion = number(source.MEAN_MOTION)
    const period = number(source.PERIOD) ?? (meanMotion && meanMotion > 0 ? 1440 / meanMotion : null)
    const altitude = number(source.PERIGEE) ?? number(source.PERIAPSIS) ?? number(contact?.perigee)

    return {
        inclination: number(source.INCLINATION),
        period,
        altitude,
        epoch: typeof source.EPOCH === 'string' ? source.EPOCH : null,
        node: angle(source.RA_OF_ASC_NODE),
        anomaly: angle(source.MEAN_ANOMALY),
        argument: angle(source.ARG_OF_PERICENTER),
        eccentricity: angle(source.ECCENTRICITY),
    }
}

function angle(value) {
    if (value === null || value === undefined || value === '') {
        return null
    }

    return number(value)
}

function present(value) {
    return typeof value === 'number' && Number.isFinite(value)
}

function clampUnit(value) {
    return Math.max(-1, Math.min(1, value))
}

function gmstRadians(date) {
    const julian = date.getTime() / 86400000 + 2440587.5
    const century = (julian - 2451545.0) / 36525
    const degrees = 280.46061837
        + 360.98564736629 * (julian - 2451545.0)
        + 0.000387933 * century * century
        - (century * century * century) / 38710000

    return ((degrees % 360) + 360) % 360 * Math.PI / 180
}

function trueAnomaly(meanAnomaly, eccentricity) {
    const eccentricityValue = eccentricity ?? 0
    if (!(eccentricityValue > 0)) {
        return meanAnomaly
    }
    const mean = Math.atan2(Math.sin(meanAnomaly), Math.cos(meanAnomaly))
    let eccentric = mean
    for (let step = 0; step < 12; step += 1) {
        const slope = 1 - eccentricityValue * Math.cos(eccentric)
        if (slope === 0) {
            break
        }
        const next = eccentric - (eccentric - eccentricityValue * Math.sin(eccentric) - mean) / slope
        if (Math.abs(next - eccentric) < 1e-10) {
            eccentric = next
            break
        }
        eccentric = next
    }

    return Math.atan2(
        Math.sqrt(1 - eccentricityValue * eccentricityValue) * Math.sin(eccentric),
        Math.cos(eccentric) - eccentricityValue,
    )
}

function shapePoint(inclination, theta, period) {
    const incl = inclination * Math.PI / 180
    const lat = Math.asin(clampUnit(Math.sin(incl) * Math.sin(theta)))
    const orbitalLon = Math.atan2(Math.cos(incl) * Math.sin(theta), Math.cos(theta))
    const elapsed = (theta * period) / (Math.PI * 2)
    const earth = (Math.PI * 2 * elapsed) / SIDEREAL_MINUTES

    return {
        lat: lat * 180 / Math.PI,
        lon: wrapDegrees((orbitalLon - earth) * 180 / Math.PI),
    }
}

function locatedPoint(inclination, eccentricity, mean, argument, node, date) {
    const argumentOfLatitude = trueAnomaly(mean, eccentricity) + argument
    const incl = inclination * Math.PI / 180
    const lat = Math.asin(clampUnit(Math.sin(incl) * Math.sin(argumentOfLatitude)))
    const orbitalLon = Math.atan2(Math.cos(incl) * Math.sin(argumentOfLatitude), Math.cos(argumentOfLatitude))
    const longitude = node + orbitalLon - gmstRadians(date)

    return {
        lat: lat * 180 / Math.PI,
        lon: wrapDegrees(longitude * 180 / Math.PI),
    }
}

function propagation(elements, date) {
    const inclination = elements?.inclination
    const period = elements?.period
    const epoch = parseEpoch(elements?.epoch)
    if (inclination === null || inclination === undefined || period === null || period <= 0 || epoch === null) {
        return null
    }
    const elapsed = (date.getTime() - epoch) / 60000
    const located = present(elements.node) || present(elements.anomaly) || present(elements.argument)
    if (!located) {
        const theta = (Math.PI * 2 * elapsed) / period
        const place = shapePoint(inclination, theta, period)

        return {
            ...place,
            altitude: elements.altitude ?? null,
            theta,
            inclination,
            period,
            located: false,
        }
    }
    const eccentricity = Math.min(0.95, Math.max(0, elements.eccentricity ?? 0))
    const mean = ((elements.anomaly ?? 0) * Math.PI) / 180 + (Math.PI * 2 * elapsed) / period
    const argument = ((elements.argument ?? 0) * Math.PI) / 180
    const node = ((elements.node ?? 0) * Math.PI) / 180
    const place = locatedPoint(inclination, eccentricity, mean, argument, node, date)

    return {
        ...place,
        altitude: elements.altitude ?? null,
        theta: mean,
        inclination,
        period,
        located: true,
        eccentricity,
        argument,
        node,
    }
}

export function subpoint(elements, date) {
    const state = propagation(elements, date)
    if (!state) {
        return null
    }

    return {
        lat: state.lat,
        lon: state.lon,
        altitude: state.altitude,
    }
}

export function tracksGround(elements) {
    return elements?.inclination !== null
        && elements?.inclination !== undefined
        && elements.inclination >= 1
        && elements.period !== null
        && elements.period < 1000
}

function loopOffset(index) {
    return -Math.PI + (Math.PI * 2 * index) / TRACK_STEPS
}

/**
 * One revolution of the ground track. Catalog rows draw the shape with the
 * ascending node at longitude zero. Element rows walk the same revolution
 * through the epoch, node, and anomaly.
 *
 * @param {{ inclination: number | null, period: number | null, node?: number | null, anomaly?: number | null, argument?: number | null, eccentricity?: number | null, epoch?: string | null, altitude?: number | null }} elements
 */
export function referenceTrack(elements) {
    const inclination = elements?.inclination
    const period = elements?.period
    if (inclination === null || inclination === undefined || period === null || period <= 0) {
        return []
    }
    const points = []
    for (let index = 0; index <= TRACK_STEPS; index += 1) {
        const theta = (Math.PI * 2 * index) / TRACK_STEPS
        points.push({
            ...shapePoint(inclination, theta, period),
            ahead: theta > 0 && theta <= 1.1,
        })
    }

    return points
}

export function groundTrack(elements, date) {
    const state = propagation(elements, date)
    if (!state) {
        return referenceTrack(elements)
    }
    const points = []
    for (let index = 0; index <= TRACK_STEPS; index += 1) {
        const offset = loopOffset(index)
        if (!state.located) {
            points.push({
                ...shapePoint(state.inclination, state.theta + offset, state.period),
                ahead: offset >= -0.02 && offset <= 1.1,
            })
            continue
        }
        const minutes = (offset * state.period) / (Math.PI * 2)
        const when = new Date(date.getTime() + minutes * 60000)
        points.push({
            ...locatedPoint(state.inclination, state.eccentricity, state.theta + offset, state.argument, state.node, when),
            ahead: offset >= -0.02 && offset <= 1.1,
        })
    }

    return points
}

/**
 * Aim south and east of the fix so the marker sits up-left of disk center
 * and the leader runs down-right to the plate.
 */
export function cameraFor(fix) {
    return {
        lat: Math.max(-62, Math.min(62, fix.lat - 16)),
        lon: wrapDegrees(fix.lon + 14),
    }
}

/**
 * Drag the earth with the pointer. A rightward drag moves the surface right,
 * so the camera looks further west. A downward drag brings the north into view.
 *
 * @param {{ lat: number, lon: number }} camera
 * @param {number} dx
 * @param {number} dy
 * @param {number} radius CSS-pixel radius of the disk
 */
export function dragCamera(camera, dx, dy, radius) {
    const span = radius > 1 ? radius : 1
    const turn = (180 / Math.PI) / span

    return {
        lat: Math.max(-80, Math.min(80, camera.lat + dy * turn)),
        lon: wrapDegrees(camera.lon - dx * turn),
    }
}

export function sunPosition(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0)
    const day = (date.getTime() - start) / 86400000
    const declination = -23.44 * Math.cos(((360 / 365) * (day + 10) * Math.PI) / 180)
    const hours = date.getUTCHours() + (date.getUTCMinutes() / 60) + (date.getUTCSeconds() / 3600)

    return {
        lat: declination,
        lon: wrapDegrees(-15 * (hours - 12)),
    }
}

export function formatHemisphere(value, positive, negative) {
    const hemisphere = value >= 0 ? positive : negative

    return `${Math.abs(value).toFixed(2)} ${hemisphere}`
}

export function formatUtc(date) {
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    const seconds = String(date.getUTCSeconds()).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')

    return {
        time: `${hours}:${minutes}:${seconds} Z`,
        date: `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    }
}

export function formatAltitude(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '--'
    }
    const numberValue = Number(value)

    return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(1)
}
