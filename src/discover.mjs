#!/usr/bin/env node
// Discover top traders by category-specific PNL for a given tag
// Usage: node src/discover.mjs [tag]
// Example: node src/discover.mjs "Pre-Market"

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  fetchAllEvents, filterEventsByTag, extractMarkets,
  fetchHolders, fetchPositions, shortenAddress, sleep
} from './api.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CONFIG_PATH = join(ROOT, 'config.json')

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  const tag = process.argv[2] || config.tag || 'Pre-Market'
  const topCount = config.topTradersCount || 10

  console.log(`\n=== Discovering top ${topCount} traders for "${tag}" ===\n`)

  // Step 1: Fetch events and filter
  console.log('Step 1: Fetching events...')
  const allEvents = await fetchAllEvents()
  console.log(`  Fetched ${allEvents.length} total events`)

  const taggedEvents = filterEventsByTag(allEvents, tag)
  console.log(`  Found ${taggedEvents.length} events with "${tag}" tag`)

  const markets = extractMarkets(taggedEvents)
  console.log(`  Total markets: ${markets.length}`)

  if (markets.length === 0) {
    console.log('No markets found. Exiting.')
    return
  }

  // Collect conditionIds for PNL filtering
  const conditionIds = new Set(markets.map(m => m.conditionId).filter(Boolean))

  // Step 2: Fetch holders for all markets
  console.log('\nStep 2: Fetching holders...')
  const walletMap = new Map()

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i]
    if (!market.conditionId) continue

    try {
      const holders = await fetchHolders(market.conditionId)
      for (const h of holders) {
        const existing = walletMap.get(h.proxyWallet)
        if (existing) {
          existing.totalShares += h.amount || 0
          existing.marketsCount++
        } else {
          walletMap.set(h.proxyWallet, {
            name: h.name || h.pseudonym || null,
            pseudonym: h.pseudonym || null,
            proxyWallet: h.proxyWallet,
            totalShares: h.amount || 0,
            marketsCount: 1,
          })
        }
      }
      process.stdout.write(`  Market ${i + 1}/${markets.length}\r`)
    } catch {
      // Skip failed markets
    }

    if (i % 5 === 4) await sleep(200)
  }

  console.log(`\n  Found ${walletMap.size} unique traders`)

  // Step 3: Fetch positions for top wallets by shares
  const topWallets = Array.from(walletMap.values())
    .sort((a, b) => b.totalShares - a.totalShares)
    .slice(0, 50)

  console.log('\nStep 3: Fetching positions for top 50 traders...')
  const traderPnL = []

  for (let i = 0; i < topWallets.length; i++) {
    const trader = topWallets[i]
    try {
      const positions = await fetchPositions(trader.proxyWallet)
      if (Array.isArray(positions)) {
        let categoryPnl = 0
        let categoryPositions = 0

        for (const pos of positions) {
          if (pos.conditionId && conditionIds.has(pos.conditionId)) {
            categoryPnl += (pos.cashPnl || 0)
            categoryPositions++
          }
        }

        traderPnL.push({ ...trader, categoryPnl, categoryPositions })
      }
      process.stdout.write(`  Trader ${i + 1}/${topWallets.length}\r`)
    } catch {
      // Skip
    }

    if (i % 5 === 4) await sleep(200)
  }

  // Step 4: Rank and display
  const topTraders = traderPnL
    .sort((a, b) => b.categoryPnl - a.categoryPnl)
    .slice(0, topCount)

  console.log(`\n\n${'='.repeat(76)}`)
  console.log(`  TOP ${topCount} TRADERS BY PNL — "${tag}"`)
  console.log(`${'='.repeat(76)}\n`)

  console.log(
    '#'.padEnd(4) +
    'Name'.padEnd(30) +
    'Wallet'.padEnd(16) +
    'PNL'.padStart(15) +
    'Positions'.padStart(12)
  )
  console.log('-'.repeat(76))

  for (let i = 0; i < topTraders.length; i++) {
    const t = topTraders[i]
    const displayName = t.name || t.pseudonym || shortenAddress(t.proxyWallet)
    const wallet = shortenAddress(t.proxyWallet)
    const pnl = t.categoryPnl >= 0
      ? `+$${t.categoryPnl.toFixed(2)}`
      : `-$${Math.abs(t.categoryPnl).toFixed(2)}`
    console.log(
      `${(i + 1).toString().padEnd(4)}` +
      `${displayName.padEnd(30)}` +
      `${wallet.padEnd(16)}` +
      `${pnl.padStart(15)}` +
      `${t.categoryPositions.toString().padStart(12)}`
    )
  }

  // Step 5: Save to config
  const tradersForConfig = topTraders.map(t => ({
    name: t.name || t.pseudonym || shortenAddress(t.proxyWallet),
    wallet: t.proxyWallet,
    categoryPnl: t.categoryPnl,
  }))

  config.tag = tag
  config.traders = tradersForConfig
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))

  console.log(`\n✓ Saved ${topTraders.length} traders to config.json`)
  console.log(`  Run "npm run monitor" to start tracking their moves.\n`)
}

main().catch(console.error)
