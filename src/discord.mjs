// Discord webhook helper

export async function sendDiscordMessage(webhookUrl, content) {
  if (!webhookUrl) {
    console.log('[Discord] No webhook URL configured, skipping')
    return
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[Discord] Webhook failed: ${res.status} — ${text}`)
    }
  } catch (err) {
    console.error('[Discord] Webhook error:', err.message)
  }
}

function getDirection(change) {
  if (change.type === 'new') return { label: 'BUY', emoji: '🟢' }
  if (change.type === 'closed') return { label: 'SELL', emoji: '🔴' }
  // Changed position
  if (change.sizeDelta > 0) return { label: 'BUY MORE', emoji: '🟢' }
  return { label: 'SELL', emoji: '🔴' }
}

// Format a trade alert as a Discord embed
export function buildTradeEmbed(traderName, traderWallet, changes) {
  const traderUrl = `https://polymarket.com/profile/${traderWallet}`

  const fields = changes.map(c => {
    const dir = getDirection(c)
    const sizeChange = c.sizeDelta > 0 ? `+${c.sizeDelta.toFixed(2)}` : c.sizeDelta.toFixed(2)
    const marketUrl = c.eventSlug ? `https://polymarket.com/event/${c.eventSlug}` : null
    const marketLink = marketUrl ? `[${c.title || 'Unknown'}](${marketUrl})` : (c.title || 'Unknown')

    const priceInfo = c.curPrice ? `**Price:** $${c.curPrice.toFixed(3)}` : null
    const avgPriceInfo = c.avgPrice ? `**Avg Entry:** $${c.avgPrice.toFixed(3)}` : null
    const estValue = c.curPrice && c.size ? `**Est Value:** $${(c.curPrice * c.size).toFixed(2)}` : null

    return {
      name: `${dir.emoji} ${dir.label} — ${c.outcome || 'Position'}`,
      value: [
        `**Market:** ${marketLink}`,
        c.type === 'new'
          ? `**Shares:** ${c.size.toFixed(2)}`
          : c.type === 'closed'
          ? `**Sold:** ${Math.abs(c.sizeDelta).toFixed(2)} shares`
          : `**Change:** ${sizeChange} shares | **Total:** ${c.size.toFixed(2)}`,
        priceInfo && avgPriceInfo ? `${priceInfo} | ${avgPriceInfo}` : priceInfo || avgPriceInfo || null,
        estValue,
        c.cashPnl != null ? `**PNL:** $${c.cashPnl.toFixed(2)}` : null,
      ].filter(Boolean).join('\n'),
      inline: false,
    }
  })

  const hasBuy = changes.some(c => c.sizeDelta > 0 || c.type === 'new')
  const hasSell = changes.some(c => c.sizeDelta < 0 || c.type === 'closed')

  return {
    embeds: [{
      title: `📊 ${traderName} made ${changes.length} move${changes.length > 1 ? 's' : ''}`,
      url: traderUrl,
      color: hasBuy && !hasSell ? 0x00ff00 : hasSell && !hasBuy ? 0xff0000 : 0xffaa00,
      fields: fields.slice(0, 25), // Discord max 25 fields
      timestamp: new Date().toISOString(),
      footer: { text: 'PolyTracker' },
    }],
  }
}
