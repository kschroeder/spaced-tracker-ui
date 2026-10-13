<template>
    <div ref="rootEl" class="globe-view" :class="{ 'is-turning': turning }">
        <canvas
            ref="canvasEl"
            class="globe-disk"
            :style="diskStyle"
            :width="RENDER_SIZE"
            :height="RENDER_SIZE"
            aria-label="Earth. Drag to rotate."
            @pointerdown="grab"
            @pointermove="spin"
            @pointerup="release"
            @pointercancel="release"
        ></canvas>
        <svg v-if="leader" class="globe-overlay" :viewBox="viewBox" aria-hidden="true">
            <line class="halo" :x1="leader.x1" :y1="leader.y1" :x2="leader.x2" :y2="leader.y2" />
            <line class="rule" :x1="leader.x1" :y1="leader.y1" :x2="leader.x2" :y2="leader.y2" />
        </svg>
        <div v-if="pipStyle" class="pip" :style="pipStyle" aria-hidden="true"></div>
        <div ref="plateEl" class="plate" :style="plateStyle">
            <h2>SUBPOINT</h2>
            <dl>
                <div v-for="row in plateRows" :key="row.label" class="field" :class="{ 'is-place': row.place }">
                    <dt>{{ row.label }}</dt>
                    <span class="leader" aria-hidden="true"></span>
                    <dd>{{ row.value }}</dd>
                </div>
            </dl>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    RENDER_SIZE,
    canPaint,
    drawGlobe,
    earthMaps,
    loadMaps,
    markerOnDisk,
    readTheme,
} from '../lib/globe.js'
import {
    cameraFor,
    dragCamera,
    elementsFromRecord,
    formatAltitude,
    formatHemisphere,
    formatUtc,
    groundTrack,
    subpoint,
    sunPosition,
} from '../lib/orbit.js'
import { locate, plateLabel } from '../lib/place.js'

const props = defineProps({
    record: { type: Object, default: null },
    contact: { type: Object, default: null },
    records: { type: Array, default: () => [] },
    contacts: { type: Array, default: () => [] },
    selected: { type: Number, default: 0 },
    theme: { type: String, default: 'phosphor' },
})

const SAMPLE_MS = 15000
const rootEl = ref(null)
const canvasEl = ref(null)
const plateEl = ref(null)
const clock = ref(new Date())
const sample = ref(bucket(new Date()))
const diskStyle = ref(null)
const plateStyle = ref(null)
const pipStyle = ref(null)
const leader = ref(null)
const viewBox = ref('0 0 1 1')
const look = ref(null)
const turning = ref(false)
let paintToken = 0
let timer = 0
let observer = null
let drag = null
let pendingLook = null
let spinFrame = 0

const roster = computed(() => {
    const rows = props.records.length > 0 ? props.records : [props.record]
    const people = props.contacts.length > 0 ? props.contacts : [props.contact]

    return rows.map((record, index) => ({
        record,
        contact: people[index] ?? null,
        selected: index === props.selected,
    }))
})
const bodies = computed(() => roster.value.map((item) => {
    const elements = elementsFromRecord(item.record, item.contact)

    return {
        selected: item.selected,
        points: groundTrack(elements, sample.value),
        fix: subpoint(elements, sample.value),
    }
}))
const selectedBody = computed(() => bodies.value.find((item) => item.selected) ?? bodies.value[0] ?? null)
const fix = computed(() => selectedBody.value?.fix ?? null)
const track = computed(() => selectedBody.value?.points ?? [])
const contextTracks = computed(() => bodies.value
    .filter((item) => !item.selected && item.points.length > 1)
    .map((item) => ({ points: item.points, selected: false })))
const markers = computed(() => bodies.value
    .filter((item) => item.fix)
    .map((item) => ({ lat: item.fix.lat, lon: item.fix.lon, selected: item.selected })))
const camera = computed(() => look.value ?? (fix.value ? cameraFor(fix.value) : { lat: 18, lon: 12 }))
const sun = computed(() => sunPosition(sample.value))
const place = computed(() => (fix.value ? locate(fix.value.lat, fix.value.lon) : null))
const plateRows = computed(() => {
    const stamp = formatUtc(clock.value)
    if (!fix.value) {
        return [
            { label: 'FIX', value: 'NO FIX' },
            { label: 'UTC', value: stamp.time },
            { label: 'DATE', value: stamp.date },
        ]
    }

    return [
        { label: 'LAT', value: formatHemisphere(fix.value.lat, 'N', 'S') },
        { label: 'LON', value: formatHemisphere(fix.value.lon, 'E', 'W') },
        { label: 'ALT KM', value: formatAltitude(fix.value.altitude) },
        { label: 'COUNTRY', value: plateLabel(place.value?.country), place: true },
        { label: 'STATE', value: plateLabel(place.value?.state), place: true },
        { label: 'UTC', value: stamp.time },
        { label: 'DATE', value: stamp.date },
    ]
})

watch([() => props.theme, () => props.selected, () => props.record, () => props.contact, sample], (next, previous) => {
    if (previous && (next[1] !== previous[1] || next[2] !== previous[2] || next[3] !== previous[3])) {
        look.value = null
    }
    if (!rootEl.value) {
        return
    }
    nextTick(() => paint())
})

onMounted(() => {
    if (canPaint()) {
        timer = window.setInterval(tick, 1000)
        if (typeof ResizeObserver === 'function' && rootEl.value) {
            observer = new ResizeObserver(() => layout(scene()))
            observer.observe(rootEl.value)
        }
    }
    paint()
})

onBeforeUnmount(() => {
    paintToken += 1
    window.clearInterval(timer)
    window.cancelAnimationFrame(spinFrame)
    observer?.disconnect()
})

function grab(event) {
    if (event.button !== undefined && event.button !== 0) {
        return
    }
    const canvas = canvasEl.value
    if (!canvas) {
        return
    }
    const rect = canvas.getBoundingClientRect()
    const radius = rect.width * 0.4
    if (radius < 8) {
        return
    }
    drag = {
        x: event.clientX,
        y: event.clientY,
        camera: { lat: camera.value.lat, lon: camera.value.lon },
        radius,
        pointerId: event.pointerId,
    }
    turning.value = true
    try {
        canvas.setPointerCapture?.(event.pointerId)
    } catch {
        // A pointer that is already gone cannot be captured. The drag still tracks moves on the disk.
    }
    event.preventDefault()
}

function spin(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
        return
    }
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (dx * dx + dy * dy < 4) {
        return
    }
    pendingLook = dragCamera(drag.camera, dx, dy, drag.radius)
    if (spinFrame) {
        return
    }
    spinFrame = window.requestAnimationFrame(() => {
        spinFrame = 0
        if (!pendingLook) {
            return
        }
        look.value = pendingLook
        paint(true)
    })
}

function release(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) {
        return
    }
    if (pendingLook) {
        look.value = pendingLook
    }
    drag = null
    pendingLook = null
    turning.value = false
    if (spinFrame) {
        window.cancelAnimationFrame(spinFrame)
        spinFrame = 0
    }
    paint(false)
}

function bucket(date) {
    return new Date(Math.floor(date.getTime() / SAMPLE_MS) * SAMPLE_MS)
}

function tick() {
    const next = new Date()
    clock.value = next
    const stepped = bucket(next)
    if (stepped.getTime() !== sample.value.getTime()) {
        sample.value = stepped
    }
}

function scene() {
    return {
        camera: camera.value,
        sun: sun.value,
        track: track.value,
        tracks: contextTracks.value,
        marker: fix.value ? { lat: fix.value.lat, lon: fix.value.lon } : null,
        markers: markers.value,
    }
}

function layout(current) {
    const column = rootEl.value
    const plate = plateEl.value
    const canvas = canvasEl.value
    if (!column || !plate || !canvas) {
        return
    }
    const colW = column.clientWidth
    const colH = column.clientHeight
    if (colW < 2 || colH < 2) {
        return
    }
    const margin = 8
    const gap = 16
    const plateWidth = plate.offsetWidth || 292
    const plateHeight = plate.offsetHeight || 160
    const beside = colW - plateWidth - gap - margin * 2
    const sideBySide = beside >= 180
    let disk
    let canvasLeft
    let canvasTop
    let plateLeft
    let parkedTop
    if (sideBySide) {
        disk = Math.max(180, Math.min(beside, colH - margin * 2))
        canvasLeft = Math.max(margin, Math.floor((colW - plateWidth - gap - disk) / 2))
        canvasTop = Math.max(margin, Math.floor((colH - disk) / 2))
        plateLeft = canvasLeft + disk + gap
        parkedTop = Math.max(margin, Math.floor((colH - plateHeight) / 2))
    } else {
        const stacked = colH - plateHeight - gap - margin
        disk = Math.min(colW - margin * 2, Math.max(48, stacked))
        if (margin + disk + gap + plateHeight > colH) {
            disk = Math.max(48, colH - plateHeight - gap - margin)
        }
        disk = Math.min(disk, colW - margin * 2)
        canvasLeft = Math.max(margin, Math.floor((colW - disk) / 2))
        canvasTop = margin
        plateLeft = Math.max(margin, Math.floor((colW - Math.min(plateWidth, colW - margin * 2)) / 2))
        parkedTop = Math.min(canvasTop + disk + 8, Math.max(margin, colH - plateHeight - 4))
    }
    diskStyle.value = {
        left: `${canvasLeft}px`,
        top: `${canvasTop}px`,
        width: `${disk}px`,
        height: `${disk}px`,
    }
    viewBox.value = `0 0 ${colW} ${colH}`

    const point = markerOnDisk(current.camera, current.marker, RENDER_SIZE)
    const placePlate = (top) => {
        plateStyle.value = {
            left: `${plateLeft}px`,
            top: `${top}px`,
            right: 'auto',
            bottom: 'auto',
        }
    }
    if (!point) {
        pipStyle.value = null
        leader.value = null
        placePlate(parkedTop)
        return
    }

    const scale = disk / RENDER_SIZE
    const x = canvasLeft + point.x * scale
    const y = canvasTop + point.y * scale
    pipStyle.value = { left: `${x}px`, top: `${y}px` }
    const plateTop = sideBySide
        ? clamp(y - plateHeight * 0.22 + 28, margin, Math.max(margin, colH - plateHeight - 16))
        : parkedTop
    placePlate(plateTop)
    const endX = sideBySide ? plateLeft : x
    const endY = sideBySide
        ? plateTop + Math.min(plateHeight * 0.42, plateHeight - 10)
        : plateTop
    const angle = Math.atan2(endY - y, endX - x)
    const reach = Math.hypot(endX - x, endY - y)
    if (reach < 24) {
        leader.value = null
        return
    }
    leader.value = {
        x1: x + Math.cos(angle) * 15,
        y1: y + Math.sin(angle) * 15,
        x2: endX,
        y2: endY,
    }
}

async function paint(draft = false) {
    const token = ++paintToken
    const current = scene()
    current.draft = draft
    await nextTick()
    if (token !== paintToken) {
        return
    }
    layout(current)
    const canvas = canvasEl.value
    const root = rootEl.value
    if (!canPaint() || !canvas || !root) {
        return
    }
    const maps = earthMaps()
    if (maps) {
        drawGlobe(canvas, maps, current, readTheme(root))
        layout(current)
        return
    }
    drawGlobe(canvas, null, current, readTheme(root))
    try {
        const loaded = await loadMaps()
        if (token !== paintToken || !canvasEl.value || !rootEl.value) {
            return
        }
        drawGlobe(canvasEl.value, loaded, scene(), readTheme(rootEl.value))
        layout(scene())
    } catch {
        // The wireframe disk stays up when a map fails to decode.
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}
</script>
