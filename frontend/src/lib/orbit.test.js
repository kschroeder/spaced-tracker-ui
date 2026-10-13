import { describe, expect, it } from 'vitest'
import {
    cameraFor,
    dragCamera,
    elementsFromRecord,
    formatAltitude,
    formatHemisphere,
    formatUtc,
    groundTrack,
    referenceTrack,
    subpoint,
    tracksGround,
} from './orbit.js'

const iss = {
    inclination: 51.64,
    period: 92.68,
    altitude: 418,
    epoch: '2026-01-01T00:00:00',
}

describe('catalog subpoint', () => {
    it('starts on the ascending node at epoch', () => {
        const fix = subpoint(iss, new Date('2026-01-01T00:00:00Z'))

        expect(fix.lat).toBeCloseTo(0, 6)
        expect(fix.lon).toBeCloseTo(0, 6)
        expect(fix.altitude).toBe(418)
    })

    it('keeps a fix inside one hemisphere long after epoch', () => {
        const when = new Date('2026-10-09T01:00:00Z')
        const fix = subpoint(iss, when)

        expect(fix.lat).toBeGreaterThan(-52)
        expect(fix.lat).toBeLessThan(52)
        expect(fix.lon).toBeGreaterThanOrEqual(-180)
        expect(fix.lon).toBeLessThanOrEqual(180)
        const track = groundTrack(iss, when)
        expect(track.every((point) => point.lon >= -180 && point.lon <= 180)).toBe(true)
        const goes = subpoint({
            inclination: 0.05,
            period: 1436.1,
            altitude: 35780,
            epoch: '2026-01-01T00:00:00',
        }, when)
        expect(Math.abs(goes.lat)).toBeLessThan(1)
        expect(Math.abs(goes.lon)).toBeLessThan(5)
    })

    it('reaches northern latitude a quarter rev after epoch', () => {
        const fix = subpoint(iss, new Date('2026-01-01T00:23:10Z'))

        expect(fix.lat).toBeGreaterThan(50)
        expect(fix.lat).toBeLessThan(52)
    })

    it('reads inclination, period, and perigee from a catalog row', () => {
        const elements = elementsFromRecord({
            INCLINATION: '28.47',
            MEAN_MOTION: 15.09117585,
            PERIAPSIS: 535,
            EPOCH: '2026-01-01T00:00:00',
        }, { perigee: 1 })

        expect(elements.inclination).toBeCloseTo(28.47)
        expect(elements.period).toBeCloseTo(1440 / 15.09117585)
        expect(elements.altitude).toBe(535)
        expect(subpoint(elements, new Date('2026-01-01T00:00:00Z')).lat).toBeCloseTo(0, 5)
    })

    it('aims the camera up-left of a low-orbit track', () => {
        const camera = cameraFor({ lat: 46.2, lon: 10.4 })

        expect(camera.lat).toBeCloseTo(30.2)
        expect(camera.lon).toBeCloseTo(24.4)
        expect(cameraFor({ lat: 80, lon: 0 }).lat).toBe(62)
        expect(cameraFor({ lat: -80, lon: 0 }).lat).toBe(-62)
        const track = groundTrack(iss, new Date('2026-01-01T00:00:00Z'))
        expect(track).toHaveLength(181)
        expect(track.some((point) => point.ahead)).toBe(true)
        expect(track.some((point) => !point.ahead)).toBe(true)
        const latitudes = track.map((point) => point.lat)
        expect(Math.max(...latitudes)).toBeGreaterThan(50)
        expect(Math.min(...latitudes)).toBeLessThan(-50)
        const onNode = track.find((point) => point.ahead)
        expect(Math.abs(onNode.lat)).toBeLessThan(46)
    })

    it('traces a catalog shape without a fix and places an elements dot', () => {
        const shape = referenceTrack({ inclination: 45, period: 95.3 })
        expect(shape.length).toBe(181)
        expect(Math.max(...shape.map((point) => point.lat))).toBeCloseTo(45, 0)
        const catalog = elementsFromRecord({
            INCLINATION: 45,
            PERIOD: 95.3,
            PERIGEE: 540,
        }, null)
        expect(subpoint(catalog, new Date('2026-10-13T00:00:00Z'))).toBeNull()
        expect(groundTrack(catalog, new Date('2026-10-13T00:00:00Z'))).toHaveLength(181)

        const disk = elementsFromRecord({
            INCLINATION: 90,
            PERIOD: 90,
            EPOCH: '2026-01-01T00:00:00Z',
            RA_OF_ASC_NODE: 0,
            ARG_OF_PERICENTER: 0,
            MEAN_ANOMALY: 0,
            ECCENTRICITY: 0,
            PERIAPSIS: 400,
        }, null)
        const when = new Date('2026-01-01T00:00:00Z')
        const atNode = subpoint(disk, when)
        const quarter = subpoint({ ...disk, anomaly: 90 }, when)
        expect(atNode.lat).toBeCloseTo(0, 4)
        expect(atNode.altitude).toBe(400)
        expect(Math.abs(quarter.lat)).toBeGreaterThan(80)
        const trace = groundTrack(disk, when)
        const nearest = trace.reduce((best, point) => {
            const distance = Math.abs(point.lat - atNode.lat) + Math.abs(point.lon - atNode.lon)
            return distance < best.distance ? { distance, point } : best
        }, { distance: Infinity, point: null })
        expect(nearest.distance).toBeLessThan(2)
    })

    it('returns no fix and no track when the row has no orbit', () => {
        const elements = elementsFromRecord({ OBJECT_NAME: 'JWST' }, null)

        expect(subpoint(elements, new Date())).toBeNull()
        expect(groundTrack(elements, new Date())).toEqual([])
        expect(tracksGround({ inclination: 0.05, period: 1436.1 })).toBe(false)
    })

    it('drags the camera west and north with the pointer', () => {
        const radius = 100
        const right = dragCamera({ lat: 10, lon: 20 }, radius, 0, radius)
        const down = dragCamera({ lat: 10, lon: 20 }, 0, radius, radius)

        expect(right.lon).toBeCloseTo(20 - (180 / Math.PI), 5)
        expect(right.lat).toBeCloseTo(10, 5)
        expect(down.lat).toBeCloseTo(10 + (180 / Math.PI), 5)
        expect(down.lon).toBeCloseTo(20, 5)
        expect(dragCamera({ lat: 70, lon: 0 }, 0, 500, 10).lat).toBe(80)
        expect(dragCamera({ lat: -70, lon: 0 }, 0, -500, 10).lat).toBe(-80)
    })

    it('formats the plate the way the console writes coordinates', () => {
        expect(formatHemisphere(46.2, 'N', 'S')).toBe('46.20 N')
        expect(formatHemisphere(-137.2, 'E', 'W')).toBe('137.20 W')
        expect(formatHemisphere(0, 'N', 'S')).toBe('0.00 N')
        expect(formatAltitude(418)).toBe('418')
        expect(formatAltitude(92.68)).toBe('92.7')
        expect(formatAltitude(null)).toBe('--')
        expect(formatUtc(new Date('2026-10-08T13:52:06Z'))).toEqual({
            time: '13:52:06 Z',
            date: '08 OCT 2026',
        })
    })
})
