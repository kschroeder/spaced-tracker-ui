<template>
    <div class="screen" :data-theme="theme">
        <div class="bezel" :class="{ 'is-inspect': inspecting, 'is-locked': locked }">
            <header class="top">
                <div class="badge" aria-hidden="true">ST</div>
                <div>
                    <p class="kicker">ST-01</p>
                    <h1>SPACED TRACKER</h1>
                    <p class="subtitle">ORBITAL CATALOG SYSTEM</p>
                </div>
                <div class="badge" aria-hidden="true">ST</div>
            </header>

            <div ref="stageEl" class="stage">
            <div class="grid deck">
                <section class="panel">
                    <h2>SYSTEM MODE</h2>
                    <button
                        v-for="item in MODES"
                        :key="item.id"
                        type="button"
                        class="choice"
                        :aria-pressed="mode === item.id"
                        @click="mode = item.id"
                    >
                        {{ item.label }}
                    </button>
                </section>
                <section class="panel">
                    <h2>OBJECT CLASS</h2>
                    <button
                        v-for="item in OBJECT_CLASSES"
                        :key="item.id"
                        type="button"
                        class="choice"
                        :aria-pressed="objectClass === item.id"
                        @click="objectClass = item.id"
                    >
                        {{ item.label }}
                    </button>
                </section>
                <section class="panel">
                    <h2>REGIME</h2>
                    <button
                        v-for="item in REGIMES"
                        :key="item"
                        type="button"
                        class="choice"
                        :aria-pressed="orbit === item"
                        @click="orbit = item"
                    >
                        {{ item }}
                    </button>
                </section>
                <section class="panel">
                    <h2>STATUS</h2>
                    <button
                        v-for="item in STATUSES"
                        :key="item"
                        type="button"
                        class="choice"
                        :aria-pressed="status === item"
                        @click="status = item"
                    >
                        {{ item }}
                    </button>
                </section>
                <section class="panel site-panel">
                    <h2>SITE</h2>
                    <div class="site-choices">
                        <button
                            type="button"
                            class="choice"
                            :aria-pressed="site === 'ALL'"
                            @click="site = 'ALL'"
                        >
                            ALL
                        </button>
                        <button
                            v-for="item in sites"
                            :key="item.code"
                            type="button"
                            class="choice"
                            :aria-pressed="site === item.code"
                            @click="site = item.code"
                        >
                            {{ item.name }}
                        </button>
                    </div>
                </section>
                <section class="panel search-panel">
                    <h2>SEARCH</h2>
                    <input
                        ref="searchInput"
                        v-model="search"
                        class="search"
                        type="search"
                        aria-label="Search catalog"
                        placeholder="NAME OR CATALOG TEXT"
                        @keydown.enter.prevent="refresh"
                    />
                </section>
            </div>

            <div class="index-gap" aria-hidden="true"></div>
            <div ref="indexEl" class="index" :class="{ 'is-sliding': sliding }">
                <h2 class="table-head">CONTACT INDEX</h2>
                <p v-if="error" class="error" role="alert">{{ error }}</p>
                <div ref="headScrollEl" class="table-head-scroll" aria-hidden="true">
                    <table class="index-table">
                        <colgroup>
                            <col v-for="column in COLUMNS" :key="column.key" :class="'col-' + column.key" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th v-for="column in COLUMNS" :key="column.key" scope="col">{{ column.label }}</th>
                            </tr>
                        </thead>
                    </table>
                </div>
                <div ref="bodyScrollEl" class="table-wrap" @scroll="syncIndexScroll">
                    <table class="index-table">
                        <colgroup>
                            <col v-for="column in COLUMNS" :key="column.key" :class="'col-' + column.key" />
                        </colgroup>
                        <thead class="clip-head">
                            <tr>
                                <th v-for="column in COLUMNS" :key="column.key" scope="col">{{ column.label }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="contacts.length === 0">
                                <td class="empty" colspan="7">NO CONTACTS</td>
                            </tr>
                            <tr
                                v-for="(contact, index) in contacts"
                                :key="contact.id + '-' + index"
                                :class="{ 'is-selected': index === selected, 'is-veiled': veiling && index >= selected }"
                                @click="choose(index)"
                            >
                                <td>{{ contact.id }}</td>
                                <td>{{ contact.name || contact.designation }}</td>
                                <td>{{ contact.class }}</td>
                                <td>{{ contact.orbit }}</td>
                                <td>{{ formatPerigee(contact.perigee) }}</td>
                                <td>{{ contact.country }}</td>
                                <td>{{ contact.status }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <section v-if="inspecting" class="dossier" aria-label="Object file">
                <div class="dossier-head">
                    <span>{{ fileTitle }}</span>
                    <span>{{ fileName }}</span>
                    <span>{{ link }} · ESC INDEX</span>
                </div>
                <div class="dossier-body">
                    <dl class="dossier-grid">
                        <div v-for="(field, fieldIndex) in fileFields" :key="field.key + '-' + fieldIndex" class="field">
                            <dt>{{ field.label }}</dt>
                            <span class="leader" aria-hidden="true"></span>
                            <dd>{{ field.value }}</dd>
                        </div>
                    </dl>
                    <GlobeView
                        :record="records[selected]"
                        :contact="current"
                        :records="records"
                        :contacts="contacts"
                        :selected="selected"
                        :theme="theme"
                    />
                </div>
            </section>

            <div v-if="capturing && current" ref="sheetEl" class="capture-sheet" aria-hidden="true">
                <div class="index">
                    <h2 class="table-head">CONTACT INDEX</h2>
                    <div class="table-wrap">
                        <table class="index-table">
                            <colgroup>
                                <col v-for="column in COLUMNS" :key="column.key" :class="'col-' + column.key" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th v-for="column in COLUMNS" :key="column.key" scope="col">{{ column.label }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr class="is-selected">
                                    <td>{{ current.id }}</td>
                                    <td>{{ current.name || current.designation }}</td>
                                    <td>{{ current.class }}</td>
                                    <td>{{ current.orbit }}</td>
                                    <td>{{ formatPerigee(current.perigee) }}</td>
                                    <td>{{ current.country }}</td>
                                    <td>{{ current.status }}</td>
                                </tr>
                                <tr v-for="(contact, index) in capturedTail" :key="contact.id + '-tail-' + index">
                                    <td>{{ contact.id }}</td>
                                    <td>{{ contact.name || contact.designation }}</td>
                                    <td>{{ contact.class }}</td>
                                    <td>{{ contact.orbit }}</td>
                                    <td>{{ formatPerigee(contact.perigee) }}</td>
                                    <td>{{ contact.country }}</td>
                                    <td>{{ contact.status }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <section class="dossier">
                    <div class="dossier-head">
                        <span>{{ fileTitle }}</span>
                        <span>{{ fileName }}</span>
                        <span>{{ link }} · ESC INDEX</span>
                    </div>
                    <div class="dossier-body">
                        <dl class="dossier-grid">
                            <div v-for="(field, fieldIndex) in fileFields" :key="field.key + '-sheet-' + fieldIndex" class="field">
                                <dt>{{ field.label }}</dt>
                                <span class="leader" aria-hidden="true"></span>
                                <dd>{{ field.value }}</dd>
                            </div>
                        </dl>
                        <GlobeView
                        :record="records[selected]"
                        :contact="current"
                        :records="records"
                        :contacts="contacts"
                        :selected="selected"
                        :theme="theme"
                    />
                    </div>
                </section>
            </div>
            </div>

            <footer>
                <span>ARROWS MOVE</span>
                <span>{{ inspecting ? 'RETURN INDEX' : 'RETURN DETAIL' }}</span>
                <button type="button" @click="cycleTheme">T THEME</button>
                <span>/ SEARCH</span>
                <button type="button" :disabled="page <= 1" @click="stepPage(-1)">PREV</button>
                <span>{{ pageLabel }}</span>
                <button type="button" :disabled="!hasNext" @click="stepPage(1)">NEXT</button>
                <span class="link-state">LINK {{ link }}</span>
                <span>{{ matchLabel }}</span>
            </footer>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GlobeView from './GlobeView.vue'
import { loadCatalog, loadLaunchSites } from '../lib/api.js'
import { canPaint, loadMaps } from '../lib/globe.js'
import {
    MODES,
    OBJECT_CLASSES,
    PAGE_SIZE,
    REGIMES,
    STATUSES,
    contactFields,
    filterIndex,
    formatPerigee,
    nextTheme,
    recordFields,
} from '../lib/catalog.js'

const COLUMNS = [
    { key: 'id', label: 'ID' },
    { key: 'designation', label: 'DESIGNATION' },
    { key: 'class', label: 'CLASS' },
    { key: 'orbit', label: 'ORBIT' },
    { key: 'perigee', label: 'PERIGEE' },
    { key: 'country', label: 'COUNTRY' },
    { key: 'status', label: 'STATUS' },
]

const theme = ref(storedTheme())
const mode = ref('catalog')
const objectClass = ref('ALL')
const orbit = ref('ALL')
const status = ref('ALL')
const site = ref('ALL')
const sites = ref([])
const page = ref(1)
const search = ref('')
const link = ref('OFFLINE')
const contacts = ref([])
const records = ref([])
const matchTotal = ref(null)
const fileClass = ref('')
const selected = ref(0)
const detailOpen = ref(false)
const locked = ref(false)
const sliding = ref(false)
const capturing = ref(false)
const veiling = ref(false)
const error = ref('')
const searchInput = ref(null)
const indexEl = ref(null)
const stageEl = ref(null)
const sheetEl = ref(null)
const headScrollEl = ref(null)
const bodyScrollEl = ref(null)
let searchTimer = 0
let slideToken = 0
let requestToken = 0
let indexObserver = null
let active = true

const current = computed(() => contacts.value[selected.value] ?? null)
const inspecting = computed(() => detailOpen.value && current.value !== null)
const pageLabel = computed(() => {
    const currentPage = String(page.value).padStart(2, '0')
    if (matchTotal.value === null) {
        return `PAGE ${currentPage}`
    }
    const pages = Math.max(1, Math.ceil(matchTotal.value / PAGE_SIZE))

    return `PAGE ${currentPage}/${String(pages).padStart(2, '0')}`
})
const hasNext = computed(() => {
    if (matchTotal.value !== null) {
        return page.value * PAGE_SIZE < matchTotal.value
    }

    return contacts.value.length === PAGE_SIZE
})
const matchLabel = computed(() => {
    if (matchTotal.value === null) {
        return `${String(contacts.value.length).padStart(2, '0')} CONTACTS`
    }

    return `${matchTotal.value} MATCHES`
})
const fileTitle = computed(() => (fileClass.value ? `${fileClass.value.toUpperCase()} FILE` : 'OBJECT FILE'))
const fileName = computed(() => current.value?.name || current.value?.designation || current.value?.id || '--')
const fileFields = computed(() => {
    const gathered = recordFields(records.value[selected.value])

    return gathered.length > 0 ? gathered : contactFields(current.value)
})
const capturedTail = computed(() => contacts.value.slice(selected.value + 1))

watch(theme, (value) => {
    localStorage.setItem('spaced-tracker-theme', value)
})

watch([mode, objectClass, orbit, status, site], () => {
    retarget()
})

watch(search, () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
        retarget()
    }, 200)
})

watch(page, () => {
    dropFile()
    selected.value = 0
    refresh()
})

onMounted(() => {
    window.addEventListener('keydown', onKey)
    if (typeof ResizeObserver === 'function' && bodyScrollEl.value) {
        indexObserver = new ResizeObserver(() => syncIndexScroll())
        indexObserver.observe(bodyScrollEl.value)
    }
    refresh()
    loadLaunchSites().then((rows) => {
        if (active) {
            sites.value = rows
        }
    })
    if (canPaint()) {
        loadMaps().catch(() => {})
    }
})

onBeforeUnmount(() => {
    active = false
    window.removeEventListener('keydown', onKey)
    window.clearTimeout(searchTimer)
    slideToken += 1
    requestToken += 1
    indexObserver?.disconnect()
    clearSlide(indexEl.value)
})

function retarget() {
    dropFile()
    if (page.value !== 1) {
        page.value = 1
        return
    }
    refresh()
}

function stepPage(delta) {
    const next = page.value + delta
    if (next < 1 || (delta > 0 && !hasNext.value)) {
        return
    }
    page.value = next
}

async function refresh() {
    const token = ++requestToken
    try {
        const result = await loadCatalog({
            mode: mode.value,
            objectClass: objectClass.value,
            search: search.value,
            orbit: orbit.value,
            status: status.value,
            site: site.value,
            page: page.value,
        })
        if (token !== requestToken) {
            return
        }
        const visible = filterIndex(result.contacts, result.records, status.value, site.value)
        link.value = result.link
        contacts.value = visible.contacts
        records.value = visible.records
        matchTotal.value = result.total
        fileClass.value = result.fileClass
        error.value = ''
        if (selected.value >= contacts.value.length) {
            selected.value = 0
        }
        await nextTick()
        syncIndexScroll()
        if (bodyScrollEl.value) {
            bodyScrollEl.value.scrollTop = 0
        }
    } catch (caught) {
        if (token !== requestToken) {
            return
        }
        link.value = 'OFFLINE'
        contacts.value = []
        records.value = []
        matchTotal.value = null
        fileClass.value = ''
        error.value = caught instanceof Error ? caught.message : 'Catalog link failed.'
        dropFile()
    }
}

function choose(index) {
    if (detailOpen.value && selected.value === index) {
        return playOver(false)
    }
    const opening = !detailOpen.value
    selected.value = index

    return opening ? playOver(true) : undefined
}

function move(step) {
    if (contacts.value.length === 0) {
        return
    }
    const next = selected.value + step
    selected.value = (next + contacts.value.length) % contacts.value.length
}

function cycleTheme() {
    theme.value = nextTheme(theme.value)
}

function onKey(event) {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    if (event.key === '/' && !typing) {
        event.preventDefault()
        if (detailOpen.value) {
            dropFile()
        }
        nextTick(() => searchInput.value?.focus())
        return
    }
    if (typing) {
        return
    }
    if (capturing.value) {
        if (event.key === 'Escape') {
            event.preventDefault()
            dropFile()
        }
        return
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        move(1)
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
    } else if (event.key === 'Enter') {
        event.preventDefault()
        return playOver(!detailOpen.value)
    } else if (event.key === 'Escape' && detailOpen.value) {
        event.preventDefault()
        return playOver(false)
    } else if (event.key === 't' || event.key === 'T') {
        cycleTheme()
    }
}

function syncIndexScroll() {
    const body = bodyScrollEl.value
    const head = headScrollEl.value
    if (!body || !head) {
        return
    }
    const bodyTable = body.querySelector('table')
    const headTable = head.querySelector('table')
    if (!bodyTable || !headTable) {
        return
    }
    if (body.clientWidth >= 1) {
        const floor = locked.value ? 0 : 1040
        const width = `${Math.max(body.clientWidth, floor)}px`
        if (bodyTable.style.width !== width) {
            bodyTable.style.width = width
        }
        if (headTable.style.width !== width) {
            headTable.style.width = width
        }
    }
    const shift = `translateX(${-body.scrollLeft}px)`
    if (headTable.style.transform !== shift) {
        headTable.style.transform = shift
    }
}

function dropFile() {
    slideToken += 1
    detailOpen.value = false
    locked.value = false
    sliding.value = false
    capturing.value = false
    veiling.value = false
    clearSlide(indexEl.value)
}

function clearSlide(node) {
    if (!node) {
        return
    }
    node.style.transition = ''
    node.style.transform = ''
}

function finishSlide(token, node) {
    if (token !== slideToken) {
        return
    }
    clearSlide(node)
    sliding.value = false
    if (!detailOpen.value) {
        locked.value = false
    }
}

async function playOver(open) {
    if (capturing.value) {
        return
    }
    if (open && !contacts.value[selected.value]) {
        return
    }
    if (open) {
        return playCapture()
    }
    return playClose()
}

async function playCapture() {
    const stage = stageEl.value
    if (!stage || prefersReducedMotion()) {
        detailOpen.value = true
        locked.value = true
        return
    }
    await nextTick()
    const row = indexEl.value?.querySelector('tr.is-selected')
    if (!row || row.getBoundingClientRect().height < 1) {
        detailOpen.value = true
        locked.value = true
        return
    }

    const token = ++slideToken
    const rowTop = row.getBoundingClientRect().top
    const stageTop = stage.getBoundingClientRect().top
    capturing.value = true
    veiling.value = true
    await nextTick()
    if (token !== slideToken) {
        return
    }
    const sheet = sheetEl.value
    const sheetRow = sheet?.querySelector('tr.is-selected')
    if (!sheet || !sheetRow) {
        detailOpen.value = true
        locked.value = true
        capturing.value = false
        veiling.value = false
        return
    }

    const chrome = sheetRow.getBoundingClientRect().top - sheet.getBoundingClientRect().top
    const startTop = rowTop - stageTop - chrome
    const line = lineHeight()
    const dest = line * 2
    const travel = startTop - dest
    sheet.style.transition = 'none'
    sheet.style.top = `${startTop}px`
    sheet.classList.add('is-placed')
    if (Math.abs(travel) < 1) {
        parkCapture(token)
        return
    }

    const steps = Math.max(2, Math.round(Math.abs(travel) / line))
    const duration = Math.min(1100, Math.max(420, steps * 48))
    await new Promise((resolve) => {
        let settled = false
        const finish = (event) => {
            if (settled || (event && event.propertyName && event.propertyName !== 'top')) {
                return
            }
            settled = true
            sheet.removeEventListener('transitionend', finish)
            window.clearTimeout(timer)
            resolve()
        }
        const timer = window.setTimeout(() => finish(), duration + 90)
        sheet.addEventListener('transitionend', finish)
        requestAnimationFrame(() => {
            if (token !== slideToken) {
                finish()
                return
            }
            requestAnimationFrame(() => {
                if (token !== slideToken) {
                    finish()
                    return
                }
                sheet.style.transition = `top ${duration}ms steps(${steps}, end)`
                sheet.style.top = `${dest}px`
            })
        })
    })
    parkCapture(token)
}

function parkCapture(token) {
    if (token !== slideToken) {
        return
    }
    detailOpen.value = true
    locked.value = true
    capturing.value = false
    veiling.value = false
}

async function playClose() {
    const node = indexEl.value
    const reduce = prefersReducedMotion()
    const firstTop = node ? node.getBoundingClientRect().top : 0
    if (!node || reduce) {
        detailOpen.value = false
        locked.value = false
        sliding.value = false
        clearSlide(node)
        return
    }

    const token = ++slideToken
    detailOpen.value = false
    sliding.value = true
    await nextTick()
    if (token !== slideToken) {
        return
    }
    const plate = indexEl.value
    if (!plate) {
        return
    }
    const dy = firstTop - plate.getBoundingClientRect().top
    if (Math.abs(dy) < 1) {
        finishSlide(token, plate)
        return
    }

    const line = lineHeight()
    const steps = Math.max(2, Math.round(Math.abs(dy) / line))
    const duration = Math.min(1100, Math.max(420, steps * 48))
    plate.style.transition = 'none'
    plate.style.transform = `translate3d(0px, ${dy}px, 28px) rotateX(8deg)`
    const settle = (event) => {
        if (event.propertyName !== 'transform') {
            return
        }
        plate.removeEventListener('transitionend', settle)
        finishSlide(token, plate)
    }
    plate.addEventListener('transitionend', settle)
    window.setTimeout(() => finishSlide(token, plate), duration + 80)
    requestAnimationFrame(() => {
        if (token !== slideToken) {
            return
        }
        requestAnimationFrame(() => {
            if (token !== slideToken) {
                return
            }
            plate.style.transition = `transform ${duration}ms steps(${steps}, end)`
            plate.style.transform = 'translate3d(0px, 0px, 0px) rotateX(0deg)'
        })
    })
}

function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function lineHeight() {
    const gap = stageEl.value?.querySelector('.index-gap')
    const measured = gap ? Number.parseFloat(window.getComputedStyle(gap).lineHeight) : Number.NaN

    return Number.isFinite(measured) && measured > 0 ? measured : 28
}

function storedTheme() {
    const saved = localStorage.getItem('spaced-tracker-theme')

    return ['phosphor', 'green', 'amber', 'white'].includes(saved) ? saved : 'phosphor'
}
</script>
