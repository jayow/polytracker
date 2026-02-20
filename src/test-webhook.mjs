#!/usr/bin/env node
// Test Discord webhook with a sample message
// Usage: npm run test-webhook

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { sendDiscordMessage, buildTradeEmbed } from './discord.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', 'config.json')

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))

  if (!config.discordWebhookUrl) {
    console.error('No discordWebhookUrl in config.json. Add your webhook URL first.')
    process.exit(1)
  }

  console.log('Sending test message to Discord...')

  const testChanges = [
    {
      type: 'new',
      title: 'Will BTC hit $100k by March?',
      outcome: 'YES',
      size: 5000,
      sizeDelta: 5000,
      cashPnl: null,
    },
    {
      type: 'changed',
      title: 'ETH above $5k by Q2?',
      outcome: 'NO',
      size: 3000,
      prevSize: 1000,
      sizeDelta: 2000,
      cashPnl: 450.50,
    },
  ]

  const embed = buildTradeEmbed('TestTrader', testChanges)
  await sendDiscordMessage(config.discordWebhookUrl, embed)

  console.log('✓ Test message sent! Check your Discord channel.')
}

main().catch(console.error)
