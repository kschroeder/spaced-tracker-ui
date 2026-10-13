// Orthographic Earth for the inspect dossier.
// The bitmap is a fixed instrument render. CSS fits it beside the plate.
// A missing canvas context, as in jsdom, is a no-op.

import dayUrl from '../assets/earth-day.jpg'
import nightUrl from '../assets/earth-night.jpg'
import topoUrl from '../assets/earth-topology.png'

export const RENDER_SIZE = 560

const RING_SCALE = RENDER_SIZE / 1040
// Median open sea on the day map. The shelves are the same water, painted brighter.
const OCEAN_LUMA = 0.005
let mapsPromise = null
let readyMaps = null
let cachedCanvas = null
let cachedKey = ''
let draftCanvas = null
let paintSupported = null
const DRAFT_SIZE = 240

export function canPaint() {
    if (paintSupported !== null) {
        return paintSupported
    }
    // jsdom prints an error and returns null. Skip the probe there.
    if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent || '')) {
        paintSupported = false

        return false
    }
    try {
        const canvas = document.createElement('canvas')
        paintSupported = Boolean(canvas.getContext && canvas.getContext('2d'))
    } catch {
        paintSupported = false
    }

    return paintSupported
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error(`Earth map failed: ${url}`))
        image.src = url
    })
}

function decode(url) {
    return loadImage(url).then((image) => {
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context || width < 1 || height < 1) {
            throw new Error(`Earth map failed: ${url}`)
        }
        context.drawImage(image, 0, 0, width, height)

        return {
            data: context.getImageData(0, 0, width, height).data,
            width,
            height,
        }
    })
}

export function earthMaps() {
    return readyMaps
}

export function loadMaps() {
    if (!mapsPromise) {
        mapsPromise = Promise.all([decode(dayUrl), decode(nightUrl), decode(topoUrl)])
            .then(([day, night, topo]) => {
                readyMaps = { day, night, topo }

                return readyMaps
            })
            .catch((error) => {
                mapsPromise = null
                throw error
            })
    }

    return mapsPromise
}

function parseColor(value) {
    const text = String(value ?? '').trim()
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
        const raw = hex[1]
        const full = raw.length === 3 ? raw.replace(/./g, (channel) => channel + channel) : raw

        return [
            Number.parseInt(full.slice(0, 2), 16),
            Number.parseInt(full.slice(2, 4), 16),
            Number.parseInt(full.slice(4, 6), 16),
        ]
    }
    const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
    if (!rgb) {
        return null
    }

    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}

function linear(rgb) {
    return rgb.map((channel) => (channel / 255) ** 2.2)
}

function cssLinear(styles, name, fallback) {
    return linear(parseColor(styles.getPropertyValue(name)) ?? fallback)
}

function tintChannel(styles, name, fallback) {
    const value = Number(styles.getPropertyValue(name))

    return Number.isFinite(value) ? value : fallback
}

export function readTheme(element) {
    const styles = getComputedStyle(element)
    const inkCss = styles.getPropertyValue('--ink').trim() || '#d8f04a'
    const dimCss = styles.getPropertyValue('--dim').trim() || '#8eae28'
    const lineCss = styles.getPropertyValue('--line').trim() || '#c6dc3c'
    const hotCss = styles.getPropertyValue('--hot').trim() || '#dff25a'
    const bgCss = styles.getPropertyValue('--bg').trim() || '#070800'

    return {
        tint: [
            tintChannel(styles, '--tint-r', 0.86),
            tintChannel(styles, '--tint-g', 1),
            tintChannel(styles, '--tint-b', 0.24),
        ],
        ink: cssLinear(styles, '--ink', [216, 240, 74]),
        hot: cssLinear(styles, '--hot', [223, 242, 90]),
        bg: cssLinear(styles, '--bg', [7, 8, 0]),
        inkCss,
        dimCss,
        lineCss,
        hotCss,
        bgCss,
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0, edge1, value) {
    const span = edge1 - edge0
    const t = span === 0 ? 0 : clamp((value - edge0) / span, 0, 1)

    return t * t * (3 - 2 * t)
}

export function basisOf(latDeg, lonDeg) {
    const lat = latDeg * Math.PI / 180
    const lon = lonDeg * Math.PI / 180
    const forward = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
    let right = [forward[2], 0, -forward[0]]
    if (right[0] * right[0] + right[2] * right[2] < 1e-8) {
        right = [1, 0, 0]
    }
    const rightLength = Math.hypot(right[0], right[1], right[2]) || 1
    right = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength]
    const up = [
        forward[1] * right[2] - forward[2] * right[1],
        forward[2] * right[0] - forward[0] * right[2],
        forward[0] * right[1] - forward[1] * right[0],
    ]
    const upLength = Math.hypot(up[0], up[1], up[2]) || 1

    return {
        right,
        up: [up[0] / upLength, up[1] / upLength, up[2] / upLength],
        forward,
    }
}

export function project(latDeg, lonDeg, frame, center, radius) {
    const lat = latDeg * Math.PI / 180
    const lon = lonDeg * Math.PI / 180
    const point = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]
    const nx = point[0] * frame.right[0] + point[1] * frame.right[1] + point[2] * frame.right[2]
    const ny = point[0] * frame.up[0] + point[1] * frame.up[1] + point[2] * frame.up[2]
    const nz = point[0] * frame.forward[0] + point[1] * frame.forward[1] + point[2] * frame.forward[2]

    return {
        nx,
        ny,
        nz,
        x: center + nx * radius,
        y: center - ny * radius,
    }
}

export function markerOnDisk(camera, fix, size = RENDER_SIZE) {
    if (!camera || !fix) {
        return null
    }
    const frame = basisOf(camera.lat, camera.lon)
    const point = project(fix.lat, fix.lon, frame, (size - 1) / 2, size * 0.4)

    return point.nz > 0.05 ? point : null
}

function sampleInto(out, map, u, v) {
    const { data, width, height } = map
    const x = u * width - 0.5
    const y = clamp(v * height - 0.5, 0, height - 1.001)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = x - x0
    const ty = y - y0
    const y1 = Math.min(height - 1, y0 + 1)
    const wrap = (value) => {
        const turned = value % width

        return turned < 0 ? turned + width : turned
    }
    const row0 = y0 * width
    const row1 = y1 * width
    const i00 = (row0 + wrap(x0)) * 4
    const i10 = (row0 + wrap(x0 + 1)) * 4
    const i01 = (row1 + wrap(x0)) * 4
    const i11 = (row1 + wrap(x0 + 1)) * 4
    for (let channel = 0; channel < 3; channel += 1) {
        const top = data[i00 + channel] + (data[i10 + channel] - data[i00 + channel]) * tx
        const bottom = data[i01 + channel] + (data[i11 + channel] - data[i01 + channel]) * tx
        out[channel] = top + (bottom - top) * ty
    }
}

export function classify(r, g, b) {
    if (r > 205 && g > 205 && b > 205) {
        return 'ice'
    }
    if (b > r + 14 && b > g + 6) {
        return 'ocean'
    }

    return 'land'
}

function sceneKey(scene, tint) {
    const track = scene.track ?? []
    const last = track.length > 0 ? track[track.length - 1] : null
    const marker = scene.marker

    return [
        tint.map((channel) => channel.toFixed(3)).join(','),
        scene.camera.lat.toFixed(2),
        scene.camera.lon.toFixed(2),
        scene.sun.lat.toFixed(2),
        scene.sun.lon.toFixed(2),
        track.length,
        last ? `${last.lat.toFixed(2)},${last.lon.toFixed(2)}` : '',
        marker ? `${marker.lat.toFixed(2)},${marker.lon.toFixed(2)}` : '',
    ].join('|')
}

function paintDisk(context, maps, frame, sun, colors, size) {
    const image = context.createImageData(size, size)
    const pixels = image.data
    const center = (size - 1) / 2
    const radius = size * 0.4
    const { day, night, topo } = maps
    const du = 1.5 / topo.width
    const dv = 1.5 / topo.height
    const coastU = 2 / day.width
    const ink = colors.ink
    const hot = colors.hot
    const tint = colors.tint
    const rgb = [0, 0, 0]
    const topoHere = [0, 0, 0]
    const topoEast = [0, 0, 0]
    const topoNorth = [0, 0, 0]
    const nightRgb = [0, 0, 0]
    const neighborRgb = [0, 0, 0]
    const glowLimit = 1.085 * 1.085

    for (let y = 0; y < size; y += 1) {
        const ny = (center - y) / radius
        const row = y * size
        for (let x = 0; x < size; x += 1) {
            const nx = (x - center) / radius
            const r2 = nx * nx + ny * ny
            const offset = (row + x) * 4
            if (r2 > 1) {
                if (r2 > glowLimit) {
                    continue
                }
                const radial = Math.sqrt(r2)
                const glow = Math.exp(-(((radial - 1) / 0.028) ** 2))
                pixels[offset] = ink[0] * glow * 255
                pixels[offset + 1] = ink[1] * glow * 255
                pixels[offset + 2] = ink[2] * glow * 255
                pixels[offset + 3] = glow * 210
                continue
            }

            const nz = Math.sqrt(1 - r2)
            let px = frame.right[0] * nx + frame.up[0] * ny + frame.forward[0] * nz
            let py = frame.right[1] * nx + frame.up[1] * ny + frame.forward[1] * nz
            let pz = frame.right[2] * nx + frame.up[2] * ny + frame.forward[2] * nz
            const length = Math.hypot(px, py, pz) || 1
            px /= length
            py /= length
            pz /= length
            const lat = Math.asin(clamp(py, -1, 1))
            const lon = Math.atan2(px, pz)
            const u = lon / (Math.PI * 2) + 0.5
            const v = 0.5 - lat / Math.PI
            sampleInto(rgb, day, u, v)
            const kind = classify(rgb[0], rgb[1], rgb[2])
            sampleInto(topoHere, topo, u, v)
            sampleInto(topoEast, topo, u + du, v)
            sampleInto(topoNorth, topo, u, v - dv)
            const heightHere = topoHere[0] / 255
            const heightEast = topoEast[0] / 255
            const heightNorth = topoNorth[0] / 255
            let ex = pz
            let ey = 0
            let ez = -px
            if (ex * ex + ez * ez < 1e-8) {
                ex = 1
                ey = 0
                ez = 0
            }
            const eastLength = Math.hypot(ex, ey, ez) || 1
            ex /= eastLength
            ey /= eastLength
            ez /= eastLength
            let nxn = py * ez - pz * ey
            let nyn = pz * ex - px * ez
            let nzn = px * ey - py * ex
            const northLength = Math.hypot(nxn, nyn, nzn) || 1
            nxn /= northLength
            nyn /= northLength
            nzn /= northLength
            // The study tuned these slopes on a 1536-wide map. Scale them
            // so a coarser vendored map does not tilt the night side into daylight.
            // Ocean relief in that map is the seafloor. The sea surface stays smooth.
            const reliefScale = topo.width / 1536
            const relief = (kind === 'ocean' ? 0 : 72) * reliefScale
            const eastBump = (heightHere - heightEast) * relief
            const northBump = (heightHere - heightNorth) * relief
            let normalX = px + ex * eastBump + nxn * northBump
            let normalY = py + ey * eastBump + nyn * northBump
            let normalZ = pz + ez * eastBump + nzn * northBump
            const normalLength = Math.hypot(normalX, normalY, normalZ) || 1
            normalX /= normalLength
            normalY /= normalLength
            normalZ /= normalLength
            const incidence = normalX * sun[0] + normalY * sun[1] + normalZ * sun[2]
            const dayAmt = smoothstep(-0.04, 0.14, incidence)
            const sunShade = 0.16 + 0.84 * clamp(incidence, 0, 1)
            const lr = (rgb[0] / 255) ** 2.2
            const lg = (rgb[1] / 255) ** 2.2
            const lb = (rgb[2] / 255) ** 2.2
            const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
            const level = kind === 'ocean' ? OCEAN_LUMA : luminance
            let dr
            let dg
            let db
            if (kind === 'ocean') {
                dr = OCEAN_LUMA * tint[0] * sunShade
                dg = OCEAN_LUMA * tint[1] * sunShade
                db = OCEAN_LUMA * tint[2] * sunShade
            } else {
                const saturation = 0.4
                dr = (luminance + (lr - luminance) * saturation) * tint[0] * sunShade
                dg = (luminance + (lg - luminance) * saturation) * tint[1] * sunShade
                db = (luminance + (lb - luminance) * saturation) * tint[2] * sunShade
            }
            if (kind === 'ice') {
                dr = dr * 0.35 + luminance * sunShade * hot[0] * 0.9
                dg = dg * 0.35 + luminance * sunShade * hot[1] * 0.9
                db = db * 0.35 + luminance * sunShade * hot[2] * 0.9
            }
            if (kind === 'ocean') {
                let hx = sun[0] + frame.forward[0]
                let hy = sun[1] + frame.forward[1]
                let hz = sun[2] + frame.forward[2]
                const halfLength = Math.hypot(hx, hy, hz) || 1
                hx /= halfLength
                hy /= halfLength
                hz /= halfLength
                const spec = clamp(normalX * hx + normalY * hy + normalZ * hz, 0, 1) ** 28
                dr += spec * hot[0] * 1.15
                dg += spec * hot[1] * 1.15
                db += spec * hot[2] * 1.15
            }
            sampleInto(nightRgb, night, u, v)
            // The night map's land is a blue haze. Cities are the warm pixels.
            const city = smoothstep(0.15, 0.36, nightRgb[0] / 255) * (nightRgb[0] + 6 > nightRgb[2] ? 1 : 0)
            const silhouette = (kind === 'ocean' ? 0.004 : 0.016) * (0.45 + level)
            const nightR = silhouette * tint[0] + city * hot[0] * 1.55
            const nightG = silhouette * tint[1] + city * hot[1] * 1.55
            const nightB = silhouette * tint[2] + city * hot[2] * 1.55
            let cr = dr * dayAmt + nightR * (1 - dayAmt)
            let cg = dg * dayAmt + nightG * (1 - dayAmt)
            let cb = db * dayAmt + nightB * (1 - dayAmt)
            sampleInto(neighborRgb, day, u + coastU, v)
            const neighbor = classify(neighborRgb[0], neighborRgb[1], neighborRgb[2])
            if (neighbor !== kind && kind !== 'ocean') {
                const shore = 0.35 + 0.5 * dayAmt
                const keep = 1 - shore
                const inkAmt = shore * (0.25 + 0.75 * dayAmt)
                cr = cr * keep + ink[0] * inkAmt
                cg = cg * keep + ink[1] * inkAmt
                cb = cb * keep + ink[2] * inkAmt
            }
            const rim = (1 - nz) ** 2.05 * (0.18 + 0.82 * dayAmt)
            cr += rim * ink[0] * 0.7
            cg += rim * ink[1] * 0.7
            cb += rim * ink[2] * 0.7
            const edge = smoothstep(1, 0.985, r2)
            pixels[offset] = clamp(cr, 0, 1) ** (1 / 2.2) * 255
            pixels[offset + 1] = clamp(cg, 0, 1) ** (1 / 2.2) * 255
            pixels[offset + 2] = clamp(cb, 0, 1) ** (1 / 2.2) * 255
            pixels[offset + 3] = 255 * edge
            if (edge < 1) {
                pixels[offset] = pixels[offset] * edge + ink[0] * (1 - edge) * 40
                pixels[offset + 1] = pixels[offset + 1] * edge + ink[1] * (1 - edge) * 40
                pixels[offset + 2] = pixels[offset + 2] * edge + ink[2] * (1 - edge) * 40
                pixels[offset + 3] = 255 * edge
            }
        }
    }
    context.putImageData(image, 0, 0)
}

export function strokePath(context, points, color, widthPx, dash, alpha, maxGap = Infinity) {
    context.save()
    context.strokeStyle = color
    context.globalAlpha = alpha
    context.lineWidth = widthPx
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.setLineDash(dash)
    let open = false
    let last = null
    points.forEach((point) => {
        if (!point || point.nz < 0.06) {
            if (open) {
                context.stroke()
                open = false
                last = null
            }
            return
        }
        if (open && last && Math.hypot(point.x - last.x, point.y - last.y) > maxGap) {
            context.stroke()
            open = false
        }
        if (!open) {
            context.beginPath()
            context.moveTo(point.x, point.y)
            open = true
            last = point
            return
        }
        context.lineTo(point.x, point.y)
        last = point
    })
    if (open) {
        context.stroke()
    }
    context.restore()
}

function paintTrack(context, rawPoints, frame, center, radius, colors, unit, gap, selected) {
    const points = rawPoints.map((point) => ({
        ...project(point.lat, point.lon, frame, center, radius),
        ahead: point.ahead,
    }))
    if (selected) {
        strokePath(context, points, '#000000', 7 * unit, [], 0.72, gap)
        strokePath(context, points, colors.inkCss, 2.8 * unit, [], 0.95, gap)
        const future = points.map((point) => (point.ahead ? point : null))
        strokePath(context, future, '#000000', 8 * unit, [], 0.8, gap)
        strokePath(context, future, colors.hotCss, 3.4 * unit, [], 1, gap)

        return points
    }
    strokePath(context, points, '#000000', 5 * unit, [2 * unit, 7 * unit], 0.55, gap)
    strokePath(context, points, colors.lineCss, 1.7 * unit, [2 * unit, 7 * unit], 0.9, gap)

    return points
}

function paintDot(context, point, colors, earth, selected) {
    if (!point || point.nz < 0.08) {
        return
    }
    const scale = 0.72 + 0.28 * point.nz
    const radius = earth * (selected ? 0.058 : 0.04) * scale
    context.save()
    context.fillStyle = colors.hotCss
    context.globalAlpha = 0.22 * point.nz
    context.beginPath()
    context.arc(point.x, point.y, radius * 2.4, 0, Math.PI * 2)
    context.fill()
    context.globalAlpha = 0.55 + 0.45 * point.nz
    context.strokeStyle = '#000000'
    context.lineWidth = earth * (selected ? 0.016 : 0.011)
    context.beginPath()
    context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = colors.lineCss
    context.lineWidth = earth * (selected ? 0.008 : 0.006)
    context.stroke()
    context.fillStyle = colors.hotCss
    context.beginPath()
    context.arc(point.x, point.y, radius * 0.46, 0, Math.PI * 2)
    context.fill()
    context.restore()
}

function paintVectors(context, scene, colors, size) {
    const center = (size - 1) / 2
    const radius = size * 0.4
    const frame = basisOf(scene.camera.lat, scene.camera.lon)
    const unit = size / 520
    for (let lat = -60; lat <= 60; lat += 30) {
        const points = []
        for (let lon = -180; lon <= 180; lon += 2) {
            points.push(project(lat, lon, frame, center, radius))
        }
        const equator = lat === 0
        strokePath(
            context,
            points,
            equator ? colors.lineCss : colors.dimCss,
            equator ? 2.2 * unit : 1.35 * unit,
            [],
            equator ? 0.9 : 0.62,
        )
    }
    for (let lon = -180; lon < 180; lon += 30) {
        const points = []
        for (let lat = -80; lat <= 80; lat += 2) {
            points.push(project(lat, lon, frame, center, radius))
        }
        const prime = lon === 0
        strokePath(
            context,
            points,
            prime ? colors.lineCss : colors.dimCss,
            prime ? 2.2 * unit : 1.35 * unit,
            [],
            prime ? 0.9 : 0.62,
        )
    }

    const gap = radius * 0.42
    const tracks = scene.tracks ?? []
    tracks.forEach((track) => {
        if (!track || track.selected || !Array.isArray(track.points) || track.points.length < 2) {
            return
        }
        paintTrack(context, track.points, frame, center, radius, colors, unit, gap, false)
    })
    const selectedTrack = scene.track ?? []
    if (selectedTrack.length > 1) {
        const points = paintTrack(context, selectedTrack, frame, center, radius, colors, unit, gap, true)
        if (scene.marker) {
            const marker = project(scene.marker.lat, scene.marker.lon, frame, center, radius)
            const ahead = points.find((point) => point.ahead && point.nz > 0.2 && Math.hypot(point.x - marker.x, point.y - marker.y) > 18 * RING_SCALE)
            if (ahead && marker.nz > 0.05) {
                const angle = Math.atan2(ahead.y - marker.y, ahead.x - marker.x)
                context.save()
                context.strokeStyle = colors.hotCss
                context.lineWidth = 2.6 * unit
                context.beginPath()
                context.moveTo(marker.x + Math.cos(angle) * 16 * RING_SCALE, marker.y + Math.sin(angle) * 16 * RING_SCALE)
                context.lineTo(marker.x + Math.cos(angle) * 34 * RING_SCALE, marker.y + Math.sin(angle) * 34 * RING_SCALE)
                context.stroke()
                context.restore()
            }
        }
    }
    const markers = scene.markers ?? []
    markers.forEach((marker) => {
        paintDot(context, project(marker.lat, marker.lon, frame, center, radius), colors, radius, marker.selected)
    })

    context.save()
    context.strokeStyle = colors.lineCss
    context.lineWidth = 2.4 * unit
    context.beginPath()
    context.arc(center, center, radius + 28 * RING_SCALE, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.arc(center, center, radius + 40 * RING_SCALE, 0, Math.PI * 2)
    context.stroke()
    context.restore()
}

function paintFallback(context, colors, size) {
    const center = (size - 1) / 2
    const radius = size * 0.4
    context.clearRect(0, 0, size, size)
    context.fillStyle = colors.bgCss
    context.beginPath()
    context.arc(center, center, radius, 0, Math.PI * 2)
    context.fill()
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ day: object, night: object, topo: object } | null} maps
 * @param {{ camera: { lat: number, lon: number }, sun: { lat: number, lon: number }, track?: { lat: number, lon: number, ahead: boolean }[], marker?: { lat: number, lon: number } | null }} scene
 * @param {ReturnType<typeof readTheme>} colors
 */
export function drawGlobe(canvas, maps, scene, colors) {
    if (!canPaint() || !scene?.camera || !scene?.sun) {
        return null
    }
    const context = canvas.getContext('2d')
    if (!context) {
        return null
    }
    const size = RENDER_SIZE
    if (canvas.width !== size) {
        canvas.width = size
    }
    if (canvas.height !== size) {
        canvas.height = size
    }
    const draft = scene.draft === true
    const key = sceneKey(scene, colors.tint)
    if (!draft && maps && cachedKey === key && cachedCanvas) {
        context.clearRect(0, 0, size, size)
        context.drawImage(cachedCanvas, 0, 0)

        return { size }
    }
    if (!maps) {
        paintFallback(context, colors, size)
        paintVectors(context, scene, colors, size)

        return { size }
    }

    const frame = basisOf(scene.camera.lat, scene.camera.lon)
    const sun = basisOf(scene.sun.lat, scene.sun.lon).forward
    if (draft) {
        if (!draftCanvas) {
            draftCanvas = document.createElement('canvas')
            draftCanvas.width = DRAFT_SIZE
            draftCanvas.height = DRAFT_SIZE
        }
        const draftContext = draftCanvas.getContext('2d', { willReadFrequently: true })
        if (draftContext) {
            paintDisk(draftContext, maps, frame, sun, colors, DRAFT_SIZE)
            context.imageSmoothingEnabled = true
            context.clearRect(0, 0, size, size)
            context.drawImage(draftCanvas, 0, 0, size, size)
            paintVectors(context, scene, colors, size)

            return { size }
        }
    }
    paintDisk(context, maps, frame, sun, colors, size)
    paintVectors(context, scene, colors, size)
    if (!cachedCanvas) {
        cachedCanvas = document.createElement('canvas')
    }
    cachedCanvas.width = size
    cachedCanvas.height = size
    const cached = cachedCanvas.getContext('2d')
    if (cached) {
        cached.drawImage(canvas, 0, 0)
        cachedKey = key
    }

    return { size }
}
