#!/usr/bin/env node
// Monitor tracked traders' positions and alert on changes via Discord
// Usage: npm run monitor

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { fetchAllEvents, filterEventsByTag, extractMarkets, fetchPositions, shortenAddress, sleep } from './api.mjs'
import { sendDiscordMessage, buildTradeEmbed } from './discord.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CONFIG_PATH = join(ROOT, 'config.json')
const STATE_PATH = join(ROOT, 'data/state.json')

// Load or initialize state
function loadState() {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  }
  return {}
}

function saveState(state) {
  const dir = join(ROOT, 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

// Compare old and new positions, return changes
function diffPositions(oldPositions, newPositions) {
  const changes = []
  const oldMap = new Map()
  const newMap = new Map()

  for (const p of oldPositions) {
    const key = `${p.conditionId}-${p.outcomeIndex ?? p.outcome ?? 0}`
    oldMap.set(key, p)
  }
  for (const p of newPositions) {
    const key = `${p.conditionId}-${p.outcomeIndex ?? p.outcome ?? 0}`
    newMap.set(key, p)
  }

  // New positions (in new but not in old)
  for (const [key, pos] of newMap) {
    if (!oldMap.has(key)) {
      changes.push({
        type: 'new',
        conditionId: pos.conditionId,
        title: pos.title || pos.slug || pos.conditionId,
        outcome: pos.outcome || `Index ${pos.outcomeIndex ?? '?'}`,
        size: pos.size || 0,
        sizeDelta: pos.size || 0,
        cashPnl: pos.cashPnl || null,
        curPrice: pos.curPrice || 0,
        avgPrice: pos.avgPrice || 0,
        eventSlug: pos.eventSlug || '',
      })
    }
  }

  // Closed positions (in old but not in new)
  for (const [key, pos] of oldMap) {
    if (!newMap.has(key)) {
      changes.push({
        type: 'closed',
        conditionId: pos.conditionId,
        title: pos.title || pos.slug || pos.conditionId,
        outcome: pos.outcome || `Index ${pos.outcomeIndex ?? '?'}`,
        size: 0,
        sizeDelta: -(pos.size || 0),
        prevSize: pos.size || 0,
        cashPnl: pos.cashPnl || null,
        curPrice: pos.curPrice || 0,
        avgPrice: pos.avgPrice || 0,
        eventSlug: pos.eventSlug || '',
      })
    }
  }

  // Changed positions (size changed)
  for (const [key, newPos] of newMap) {
    const oldPos = oldMap.get(key)
    if (oldPos) {
      const oldSize = oldPos.size || 0
      const newSize = newPos.size || 0
      // Only alert if size changed by more than 1% or at least 1 share
      const delta = Math.abs(newSize - oldSize)
      if (delta > 1 && delta / Math.max(oldSize, 1) > 0.01) {
        changes.push({
          type: 'changed',
          conditionId: newPos.conditionId,
          title: newPos.title || newPos.slug || newPos.conditionId,
          outcome: newPos.outcome || `Index ${newPos.outcomeIndex ?? '?'}`,
          size: newSize,
          prevSize: oldSize,
          sizeDelta: newSize - oldSize,
          cashPnl: newPos.cashPnl || null,
          curPrice: newPos.curPrice || 0,
          avgPrice: newPos.avgPrice || 0,
          eventSlug: newPos.eventSlug || '',
        })
      }
    }
  }

  return changes
}

async function pollOnce(config, state, conditionIds) {
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || config.discordWebhookUrl
  const { traders } = config

  for (const trader of traders) {
    const displayName = trader.name || shortenAddress(trader.wallet)

    try {
      const positions = await fetchPositions(trader.wallet)
      if (!Array.isArray(positions)) continue

      // Normalize and filter to only tag-specific positions
      const normalized = positions
        .filter(p => !conditionIds || conditionIds.has(p.conditionId))
        .map(p => ({
          conditionId: p.conditionId,
          outcomeIndex: p.outcomeIndex,
          outcome: p.outcome,
          size: p.size || 0,
          cashPnl: p.cashPnl || 0,
          curPrice: p.curPrice || 0,
          avgPrice: p.avgPrice || 0,
          title: p.title || p.slug || '',
          slug: p.slug || '',
          eventSlug: p.eventSlug || '',
        }))

      const prevPositions = state[trader.wallet] || []
      const changes = diffPositions(prevPositions, normalized)

      if (changes.length > 0) {
        console.log(`\n[${new Date().toLocaleTimeString()}] ${displayName}: ${changes.length} change(s) detected`)
        for (const c of changes) {
          const emoji = c.type === 'new' ? '🟢 NEW' : c.type === 'closed' ? '🔴 CLOSED' : '🔄 CHANGED'
          console.log(`  ${emoji}: ${c.title} (${c.outcome}) — size: ${c.sizeDelta > 0 ? '+' : ''}${c.sizeDelta.toFixed(2)}`)
        }

        // Send Discord alert
        const embed = buildTradeEmbed(displayName, trader.wallet, changes)
        await sendDiscordMessage(discordWebhookUrl, embed)
      }

      // Update state
      state[trader.wallet] = normalized
    } catch (err) {
      console.error(`  Error polling ${displayName}: ${err.message}`)
    }

    // Small delay between traders
    await sleep(500)
  }

  // Save state after each poll cycle
  saveState(state)
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))

  if (!config.traders || config.traders.length === 0) {
    console.error('No traders configured. Run "npm run discover" first to find top traders.')
    process.exit(1)
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || config.discordWebhookUrl
  if (!webhookUrl) {
    console.warn('⚠ No Discord webhook URL configured — alerts will only show in console')
  }

  const intervalSec = config.pollIntervalSeconds || 5
  const tag = config.tag || 'Pre-Market'

  // Fetch conditionIds for the tag to filter positions
  console.log(`\nFetching "${tag}" markets for position filtering...`)
  const allEvents = await fetchAllEvents()
  const taggedEvents = filterEventsByTag(allEvents, tag)
  const markets = extractMarkets(taggedEvents)
  const conditionIds = new Set(markets.map(m => m.conditionId).filter(Boolean))
  console.log(`  Found ${conditionIds.size} "${tag}" markets to filter by`)

  const state = loadState()
  const isFirstRun = Object.keys(state).length === 0

  console.log(`\n=== PolyTracker Monitor ===`)
  console.log(`  Tag: ${tag}`)
  console.log(`  Markets: ${conditionIds.size}`)
  console.log(`  Tracking: ${config.traders.length} traders`)
  console.log(`  Poll interval: ${intervalSec}s`)
  console.log(`  Discord: ${webhookUrl ? 'configured' : 'not configured'}`)
  console.log(`  State: ${isFirstRun ? 'first run — building baseline' : 'resuming from saved state'}`)
  console.log(`\nMonitoring... (Ctrl+C to stop)\n`)

  // First poll — silently build baseline state
  if (isFirstRun) {
    console.log('Building initial baseline (silent)...')
    for (const trader of config.traders) {
      try {
        const positions = await fetchPositions(trader.wallet)
        if (!Array.isArray(positions)) continue
        state[trader.wallet] = positions
          .filter(p => conditionIds.has(p.conditionId))
          .map(p => ({
            conditionId: p.conditionId, outcomeIndex: p.outcomeIndex, outcome: p.outcome,
            size: p.size || 0, cashPnl: p.cashPnl || 0,
            curPrice: p.curPrice || 0, avgPrice: p.avgPrice || 0,
            title: p.title || p.slug || '', slug: p.slug || '', eventSlug: p.eventSlug || '',
          }))
      } catch {}
      await sleep(500)
    }
    saveState(state)
    console.log(`Baseline captured: ${Object.keys(state).length} traders — now monitoring\n`)
  }

  // Continuous polling loop
  while (true) {
    await pollOnce(config, state, conditionIds)
    await sleep(intervalSec * 1000)
  }
}

main().catch(console.error)
