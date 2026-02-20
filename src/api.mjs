// Polymarket API helpers — shared across discover and monitor scripts

const GAMMA_API = 'https://gamma-api.polymarket.com/events'
const HOLDERS_API = 'https://data-api.polymarket.com/holders'
const POSITIONS_API = 'https://data-api.polymarket.com/positions'

export async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// Fetch all events from Polymarket, paginated
export async function fetchAllEvents() {
  const allEvents = []
  let offset = 0
  const pageSize = 100

  while (true) {
    const events = await fetchJSON(`${GAMMA_API}?limit=${pageSize}&offset=${offset}&closed=false`)
    if (!Array.isArray(events) || events.length === 0) break
    allEvents.push(...events)
    offset += pageSize
    if (allEvents.length > 5000) break
  }

  return allEvents
}

// Filter events by a specific tag
export function filterEventsByTag(events, tag) {
  return events.filter(event => {
    if (!event.tags || !Array.isArray(event.tags)) return false
    return event.tags.some(t => {
      const label = typeof t === 'object' ? t.label : t
      return label && label.trim() === tag
    })
  })
}

// Extract markets from events
export function extractMarkets(events) {
  const markets = []
  for (const event of events) {
    if (event.markets && Array.isArray(event.markets)) {
      for (const m of event.markets) {
        markets.push({
          conditionId: m.conditionId || m.id?.toString(),
          question: m.question || event.title,
          volume: parseFloat(m.volume) || 0,
        })
      }
    }
  }
  return markets
}

// Fetch holders for a single market
export async function fetchHolders(conditionId) {
  const data = await fetchJSON(`${HOLDERS_API}?market=${conditionId}&limit=500&minBalance=1`)
  const holders = []
  if (Array.isArray(data)) {
    for (const tokenData of data) {
      if (tokenData.holders && Array.isArray(tokenData.holders)) {
        holders.push(...tokenData.holders)
      }
    }
  }
  return holders
}

// Fetch positions for a wallet
export async function fetchPositions(wallet) {
  return fetchJSON(`${POSITIONS_API}?user=${wallet}`)
}

export function shortenAddress(address) {
  if (!address) return 'Unknown'
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}
