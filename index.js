require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")

let bot
let discordClient
let alreadyWalking = false
let smpOnline = 0
let statusMessage = null
let updatingEmbed = false
let reconnecting = false
let onlineInterval = null

// ================= MEMORY =================
const massMessageTracker = new Map()

console.log("====================================")
console.log("Container started at:", new Date().toISOString())
console.log("====================================")

// ================= RULE KEYWORDS =================

const INAPPROPRIATE = [
  "have sex","sex with","porn","nsfw","onlyfans",
  "deepthroat","send nudes","rape joke",
  "hitler was right","9/11 was funny"
]

const TOXICITY = [
  "fuck you",
  "fk you",
  "stfu",
  "you suck",
  "idiot",
  "loser",
  "no life"
]

const TOXICITY_REGEX = [
  /\bf\s*u\b/i // matches standalone "f u"
]

const SUICIDE = [
  "kys","kill yourself","slit your wrists",
  "hope you die","hope you get cancer",
  "hope your mom dies"
]

const THREATS = [
  "i will find you","i will kill you",
  "kill your family","i'll dox you",
  "pull your ip"
]

const FAKE_PATTERNS = [
  "has been banned",
  "has been permanently banned",
  "has been muted",
  "you have been banned"
]

const SLURS = [
  "nigger","faggot","tranny",
  "dirty jew","i hate gays",
  "i hate blacks","i hate jews",
  "cracker"
]

const LINK_REGEX = /(discord\.gg|https?:\/\/(?!.*invadedlands))/i

const SOLICITATION = [
  "selling account",
  "buying rank for",
  "selling robux",
  "selling vbucks",
  "paypal me","cashapp me",
  "trading riot points"
]

const BYPASS_REGEX = [
  /f\s*u\s*c\s*k\s*you/i,
  /k\s*y\s*s/i,
  /n\s*i\s*g\s*g/i
]

const PRIVATE_INFO_REGEX = [
  /\b\d{1,3}(\.\d{1,3}){3}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /instagram\.com\//i,
  /snapchat\.com\//i
]

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)

  await initializeStatusMessage()
}

// ================= BOT =================
function startBot() {
  console.log("🚀 Starting SMP Bot...")

  bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    auth: "microsoft",
    version: "1.20.1",
    profilesFolder: "/app/auth_cache",
    skipValidation: true,
    disableChatSigning: true
  })

  bot.loadPlugin(pathfinder)

  bot.once("spawn", () => {
  console.log("🌍 Spawned in HUB")
  setTimeout(() => walkToNPC(), 5000)
})

bot.on("message", async (jsonMsg) => {
  const raw = jsonMsg.toString().trim()

  // ================= ONLINE COUNT DETECTION =================
  const onlineMatch = raw.match(/\((\d+)\/(\d+)\)/)

  if (onlineMatch) {
    const current = parseInt(onlineMatch[1])
    const detectedMax = parseInt(onlineMatch[2])

    if (detectedMax === 200) {
      smpOnline = current
      await updateStatusEmbed()
      return
    }
  }

  // ================= NORMAL CHAT HANDLING =================
  if (!raw.includes(":")) return

  const colon = raw.indexOf(":")
  let before = raw.slice(0, colon).trim()
  const chat = raw.slice(colon + 1).trim()
  if (!chat) return

  let rank = "Default"
  if (before.startsWith("+")) {
    rank = "Diamond"
    before = before.substring(1).trim()
  }

  const username = before
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/&[0-9a-fk-or]/gi, "")
    .trim()

  if (!username) return

  const data = {
    username,
    rank,
    message: chat,
    lower: chat.toLowerCase()
  }

  sendToDiscord(data)
  runModeration(data)
})

  // ================= ERROR HANDLING =================

  bot.on("error", (err) => {
    console.log("Bot error:", err.code || err.message)
  })

  bot.on("end", () => {
  console.log("🔌 Bot disconnected.")

  if (onlineInterval) {
    clearInterval(onlineInterval)
    onlineInterval = null
  }

  alreadyWalking = false  // 👈 ADD THIS

  if (reconnecting) return
  reconnecting = true

  setTimeout(() => {
    reconnecting = false
    startBot()
  }, 8000)
})

// ================= WALK =================
async function walkToNPC() {
  if (alreadyWalking) return
  alreadyWalking = true

  console.log("🚶 Walking to SMP NPC (54 94 691)...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))

  bot.once("goal_reached", async () => {
    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e =>
      e.position &&
      bot.entity.position.distanceTo(e.position) < 5 &&
      (e.type === "mob" || e.type === "player")
    )

    if (!entity) {
      alreadyWalking = false
      return setTimeout(walkToNPC, 5000)
    }

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)
    bot.activateEntity(entity)

    console.log("✅ Clicked SMP NPC")
    // Start polling after server transfer delay
setTimeout(() => {
  if (onlineInterval) clearInterval(onlineInterval)

  console.log("📊 Starting /online polling")

  onlineInterval = setInterval(() => {
    if (bot && bot.player) {
      bot.chat("/online")
    }
  }, 5000)
}, 10000) // wait for transfer to complete
  })
}

// ================= MODERATION =================
function runModeration(data) {
  const { lower, message, username } = data
  let violations = []

  if (INAPPROPRIATE.some(w => lower.includes(w)))
    violations.push("Inappropriate Topics")

  if (
  TOXICITY.some(w => lower.includes(w)) ||
  TOXICITY_REGEX.some(r => r.test(message))
)
  violations.push("Toxicity")

  if (SUICIDE.some(w => lower.includes(w)))
    violations.push("Suicide Encouragement")

  if (THREATS.some(w => lower.includes(w)))
    violations.push("Threats")

  if (FAKE_PATTERNS.some(w => lower.includes(w)))
    violations.push("Faking Messages")

  if (SLURS.some(w => lower.includes(w)))
    violations.push("Derogatory Chat")

  if (SOLICITATION.some(w => lower.includes(w)))
    violations.push("Solicitation")

  if (LINK_REGEX.test(lower))
    violations.push("Inappropriate Links")

  if (BYPASS_REGEX.some(r => r.test(message)))
    violations.push("Filter Bypass")

  if (PRIVATE_INFO_REGEX.some(r => r.test(message)))
    violations.push("Leaking Private Information")

  // MASS MESSAGING (private message only)
  if (message.startsWith("/msg") || message.startsWith("/w")) {
    const now = Date.now()

    if (!massMessageTracker.has(username))
      massMessageTracker.set(username, [])

    const history = massMessageTracker.get(username)
    history.push({ msg: lower, time: now })

    const recent = history.filter(m => now - m.time < 10000)
    massMessageTracker.set(username, recent)

    const identical = recent.filter(m => m.msg === lower)
    if (identical.length >= 3)
      violations.push("Mass Messaging")
  }

  if (violations.length > 0)
    sendModerationAlert(data, violations)
}

// ================= CHAT EMBED =================
async function sendToDiscord(data) {
  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(data.rank === "Diamond" ? 0x00FFFF : 0xAAAAAA)
    .setAuthor({
      name: data.username,
      iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
    })
    .setDescription(`💬 **Message**\n> ${data.message}`)
    .addFields({
      name: "🏷 Rank",
      value: `\`${data.rank}\``,
      inline: true
    })
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

// ================= MOD ALERT =================
async function sendModerationAlert(data, violations) {
  const channel = await discordClient.channels.fetch(process.env.MOD_ALERT_CHANNEL_ID)
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle("⚠ Potential Rule Violation")
    .setAuthor({
      name: data.username,
      iconURL: `https://mc-heads.net/avatar/${encodeURIComponent(data.username)}`
    })
    .addFields(
      { name: "Server", value: "SMP", inline: true },
      { name: "Triggered Rules", value: violations.join("\n") },
      { name: "Message", value: `\`\`\`${data.message}\`\`\`` }
    )
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

async function initializeStatusMessage() {
  const channel = await discordClient.channels.fetch(process.env.STATUS_CHANNEL_ID)
  if (!channel) return

  const messages = await channel.messages.fetch({ limit: 10 })

  const botMessage = messages.find(
    msg =>
      msg.author.id === discordClient.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title?.includes("SMP")
  )

  if (botMessage) {
    statusMessage = botMessage
    console.log("♻ Reusing existing SMP status embed")
  }
}

async function updateStatusEmbed() {
  if (updatingEmbed) return
  updatingEmbed = true

  const channel = await discordClient.channels.fetch(process.env.STATUS_CHANNEL_ID)
  if (!channel) {
    updatingEmbed = false
    return
  }

  const maxPlayers = 200
  const percent = Math.min((smpOnline / maxPlayers), 1)
  const filledBars = Math.round(percent * 10)
  const emptyBars = 10 - filledBars
  const progressBar = "🟨".repeat(filledBars) + "⬛".repeat(emptyBars)

  const embed = new EmbedBuilder()
    .setColor(0x2ACFDB)
    .setTitle("🌍 SMP")
    .setDescription("```yaml\nSTATUS: Online\n```")
    .addFields(
      {
        name: "👥 Players Online",
        value: `**${smpOnline} / ${maxPlayers}**`,
        inline: false
      },
      {
        name: "📊 Capacity",
        value: `${progressBar}  **${Math.round(percent * 100)}%**`,
        inline: false
      }
    )
    .setFooter({ text: "Live updating every 5 seconds" })
    .setTimestamp()

  if (!statusMessage) {
    statusMessage = await channel.send({ embeds: [embed] })
  } else {
    await statusMessage.edit({ embeds: [embed] })
  }

  updatingEmbed = false
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()