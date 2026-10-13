import { describe, expect, it } from 'vitest'
import { basisOf, canPaint, classify, drawGlobe, markerOnDisk, project, strokePath } from './globe.js'
import { cameraFor, dragCamera } from './orbit.js'

describe('earth cover', () => {
    it('counts dark basins as ocean and leaves the ground as land', () => {
        expect(classify(6, 14, 39)).toBe('ocean')
        expect(classify(1, 6, 35)).toBe('ocean')
        expect(classify(38, 68, 137)).toBe('ocean')
        expect(classify(83, 69, 40)).toBe('land')
        expect(classify(36, 38, 23)).toBe('land')
        expect(classify(0, 0, 0)).toBe('land')
        expect(classify(250, 253, 254)).toBe('ice')
    })
})

describe('orthographic disk', () => {
    it('keeps the subpoint on the upper-left face', () => {
        const fix = { lat: 46.2, lon: 10.4 }
        const point = markerOnDisk(cameraFor(fix), fix, 640)

        expect(point).not.toBeNull()
        expect(point.nz).toBeGreaterThan(0.8)
        expect(point.x).toBeLessThan(319.5)
        expect(point.y).toBeLessThan(319.5)
        expect(markerOnDisk({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 640)).toBeNull()
    })

    it('moves the ground point with a drag', () => {
        const radius = 200
        const before = project(0, 0, basisOf(0, 0), 100, radius)
        const turned = dragCamera({ lat: 0, lon: 0 }, radius, 0, radius)
        const after = project(0, 0, basisOf(turned.lat, turned.lon), 100, radius)

        expect(after.x).toBeGreaterThan(before.x + 40)
        const lowered = dragCamera({ lat: 0, lon: 0 }, 0, radius, radius)
        const south = project(0, 0, basisOf(lowered.lat, lowered.lon), 100, radius)

        expect(south.y).toBeGreaterThan(before.y + 40)
    })

    it('strokes each facing run when the path leaves the disk', () => {
        const strokes = []
        let path = []
        const context = {
            save() {},
            restore() {},
            beginPath() {
                path = []
            },
            moveTo(x, y) {
                path = [[x, y]]
            },
            lineTo(x, y) {
                path.push([x, y])
            },
            stroke() {
                strokes.push(path.map((point) => point.slice()))
            },
            setLineDash() {},
        }

        strokePath(context, [
            { x: 0, y: 0, nz: 1 },
            { x: 10, y: 0, nz: 1 },
            { x: 20, y: 0, nz: 0 },
            { x: 30, y: 10, nz: 1 },
            { x: 40, y: 10, nz: 1 },
        ], '#ffffff', 2, [], 1)

        expect(strokes).toEqual([
            [[0, 0], [10, 0]],
            [[30, 10], [40, 10]],
        ])
    })

    it('does nothing when the canvas cannot paint', () => {
        if (canPaint()) {
            return
        }
        const canvas = document.createElement('canvas')

        expect(drawGlobe(canvas, null, {
            camera: { lat: 18, lon: 12 },
            sun: { lat: -6, lon: -20 },
            track: [],
            marker: null,
        }, {
            tint: [0.86, 1, 0.24],
            ink: [1, 1, 1],
            hot: [1, 1, 1],
            bg: [0, 0, 0],
            inkCss: '#d8f04a',
            dimCss: '#8eae28',
            lineCss: '#c6dc3c',
            hotCss: '#dff25a',
            bgCss: '#070800',
        })).toBeNull()
    })
})
