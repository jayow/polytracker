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

// Format a trade alert as a Discord embed
export function buildTradeEmbed(traderName, changes) {
  const fields = changes.map(c => {
    const emoji = c.type === 'new' ? '🟢' : c.type === 'closed' ? '🔴' : '🔄'
    const sizeChange = c.sizeDelta > 0 ? `+${c.sizeDelta.toFixed(2)}` : c.sizeDelta.toFixed(2)

    return {
      name: `${emoji} ${c.type.toUpperCase()} — ${c.outcome || 'Position'}`,
      value: [
        `**Market:** ${c.title || 'Unknown'}`,
        c.type === 'new'
          ? `**Size:** ${c.size.toFixed(2)} shares`
          : c.type === 'closed'
          ? `**Closed position** (was ${Math.abs(c.sizeDelta).toFixed(2)} shares)`
          : `**Size:** ${c.prevSize.toFixed(2)} → ${c.size.toFixed(2)} (${sizeChange})`,
        c.cashPnl != null ? `**PNL:** $${c.cashPnl.toFixed(2)}` : null,
      ].filter(Boolean).join('\n'),
      inline: false,
    }
  })

  return {
    embeds: [{
      title: `📊 ${traderName} made ${changes.length} move${changes.length > 1 ? 's' : ''}`,
      color: changes.some(c => c.type === 'new') ? 0x00ff00 : changes.some(c => c.type === 'closed') ? 0xff0000 : 0xffaa00,
      fields: fields.slice(0, 25), // Discord max 25 fields
      timestamp: new Date().toISOString(),
      footer: { text: 'PolyTracker' },
    }],
  }
}
