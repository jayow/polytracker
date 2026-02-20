import { fetchAllEvents } from './api.mjs'

const all = await fetchAllEvents()
const tagCounts = new Map()
for (const e of all) {
  if (e.tags) for (const t of e.tags) {
    const label = typeof t === 'object' ? t.label : t
    if (label) {
      const lower = label.toLowerCase()
      if (lower.includes('up') || lower.includes('down')) {
        tagCounts.set(label, (tagCounts.get(label) || 0) + 1)
      }
    }
  }
}
console.log('Matching tags:')
for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  "${tag}" — ${count} events`)
}
