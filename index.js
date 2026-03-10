require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const fs = require("fs")
const path = require("path")

let bot
let discordClient
let alreadyWalking = false
let smpOnline = 0
let statusMessage = null
let updatingEmbed = false
let reconnecting = false
let onlineInterval = null
// ================= SMP AUCTION CPI TRACKER =================
let auctionHistory = []
let lastAuctionBasket = null
let auctionMessage = null
let auctionScanning = false

let pagesScanned = 0
const MAX_AH_PAGES = 10

const CPI_ITEMS = {
  "Elytra": [],
  "Enchanted Golden Apple": [],
  "Cow Spawner": [],
  "Sheep Spawner": [],
  "Netherite Ingot": [],
  "Mace": []
}

const CPI_SAMPLE_SIZE = 3
const CPI_MIN_SAMPLE = 1
const DATA_FILE = path.join(__dirname, "auth_cache", "smp_inflation_data.json")

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

function loadInflationData() {

  try {

    if (fs.existsSync(DATA_FILE)) {

      const raw = fs.readFileSync(DATA_FILE, "utf8")
      const parsed = JSON.parse(raw)

      auctionHistory = parsed.auctionHistory || []
      lastAuctionBasket = parsed.lastAuctionBasket || null

      console.log("📂 Loaded SMP CPI history:", auctionHistory.length, "entries")

    }

  } catch (err) {

    console.log("Failed to load SMP CPI data:", err.message)

  }

}

function saveInflationData(){

  try {

    const data = {
      auctionHistory,
      lastAuctionBasket
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))

  } catch (err) {

    console.log("Failed to save SMP CPI data:", err.message)

  }

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

  setInterval(() => {

  if (!bot || !bot.player) return
  if (auctionScanning) return

  scanAuctionHouse()

}, 300000) // every 5 minutes
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
}

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

async function scanAuctionHouse() {

  if (auctionScanning) return

  auctionScanning = true
  pagesScanned = 0

  console.log("📊 Starting SMP AH CPI scan")

  for (const item in CPI_ITEMS) {
    CPI_ITEMS[item] = []
  }

  try {

    bot.chat("/ah")

    const window = await waitForWindow()

    await parseAuctionPage(window)

  } catch (err) {

    console.log("❌ AH scan failed:", err)
    auctionScanning = false

  }

}

function waitForWindow(timeout = 10000) {

  return new Promise((resolve, reject) => {

    const timer = setTimeout(() => {
      reject(new Error("Window open timeout"))
    }, timeout)

    bot.once("windowOpen", window => {
      clearTimeout(timer)
      resolve(window)
    })

  })

}

async function parseAuctionPage(window) {

  pagesScanned++

  for (let i = 0; i < 45; i++) {

    const slot = window.slots[i]
    if (!slot) continue

    let displayName = slot.nbt?.value?.display?.value?.Name?.value
    let lore = slot.nbt?.value?.display?.value?.Lore?.value

    let textLines = []

    if (displayName) {

      try {

        const parsed = JSON.parse(displayName)

        if (parsed.text) textLines.push(parsed.text)

        if (parsed.extra) {
          for (const part of parsed.extra) {
            if (part.text) textLines.push(part.text)
          }
        }

      } catch {

        textLines.push(String(displayName))

      }

    }

    if (lore) {

      if (!Array.isArray(lore)) lore = [lore]

      for (const line of lore) {
        textLines.push(String(line?.value ?? line?.text ?? line ?? ""))
      }

    }

    if (textLines.length === 0) continue

    let itemName = null
    let price = null

    const baseName = slot.name ? slot.name.toLowerCase() : ""

    for (const text of textLines) {

      const normalized = text
        .replace(/§[0-9a-fk-or]/gi,"")
        .replace(/&[0-9a-fk-or]/gi,"")
        .toLowerCase()

      if (baseName === "elytra")
  itemName = "Elytra"

if (baseName === "enchanted_golden_apple")
  itemName = "Enchanted Golden Apple"

if (baseName === "netherite_ingot")
  itemName = "Netherite Ingot"

if (baseName === "mace")
  itemName = "Mace"

if (baseName.includes("spawner")) {

  if (normalized.includes("cow"))
    itemName = "Cow Spawner"

  if (normalized.includes("sheep"))
    itemName = "Sheep Spawner"

}

      const match = text.match(/\$([\d,\.]+)/)

      if (match) {
        price = parseFloat(match[1].replace(/,/g,""))
      }

    }

    if (!itemName || !price) continue

    if (CPI_ITEMS[itemName].length < CPI_SAMPLE_SIZE) {

      const count = slot.count || 1
      const unitPrice = price / count

      CPI_ITEMS[itemName].push(unitPrice)

      console.log(`💰 SMP listing: ${itemName} $${unitPrice}`)

    }

  }

  const minimumMet = Object.values(CPI_ITEMS).some(v => v.length >= CPI_MIN_SAMPLE)

if (pagesScanned >= MAX_AH_PAGES || minimumMet) {
  finalizeAuctionBasket()
  return
}

  const nextButton = window.slots[53]

  if (!nextButton) {
    finalizeAuctionBasket()
    return
  }

  bot.clickWindow(53,0,0)

  bot.once("windowOpen", async next => {
    await parseAuctionPage(next)
  })

}

function median(arr){

  const sorted = [...arr].sort((a,b)=>a-b)
  const mid = Math.floor(sorted.length/2)

  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid-1]+sorted[mid])/2

}

function finalizeAuctionBasket(){

  let basket = 0

  for (const item in CPI_ITEMS){

    const prices = CPI_ITEMS[item]
    if (!prices.length) continue

    const med = median(prices)

    basket += med

  }

  if (basket <= 0){
    auctionScanning = false
    return
  }

  lastAuctionBasket = basket

  auctionHistory.push({
    time: Date.now(),
    basket
  })

  auctionHistory = auctionHistory.filter(
    e => Date.now() - e.time <= 24 * 60 * 60 * 1000
  )

   saveInflationData()
  updateAuctionEmbed()

  auctionScanning = false

}

function calculateAuctionInflation(minutes){

  const now = Date.now()

  const currentSamples = auctionHistory.filter(
    e => now - e.time <= 15 * 60 * 1000
  )

  const pastSamples = auctionHistory.filter(
    e =>
      now - e.time >= minutes * 60 * 1000 &&
      now - e.time <= minutes * 60 * 1000 + (15 * 60 * 1000)
  )

  if (!currentSamples.length || !pastSamples.length)
    return null

  const currentAvg =
    currentSamples.reduce((s,e)=>s+e.basket,0)/currentSamples.length

  const pastAvg =
    pastSamples.reduce((s,e)=>s+e.basket,0)/pastSamples.length

  if (pastAvg <= 0) return null

  return ((currentAvg - pastAvg) / pastAvg) * 100

}

async function updateAuctionEmbed(){

  const channel = await discordClient.channels.fetch(process.env.SMP_INFLATION_CHANNEL_ID)
  if (!channel) return

  const infl30 = calculateAuctionInflation(30)
  const infl60 = calculateAuctionInflation(60)
  const infl720 = calculateAuctionInflation(720)
  const infl1440 = calculateAuctionInflation(1440)

  function format(percent){
    if (percent === null) return "⏳ Collecting..."

    const sign = percent >= 0 ? "+" : "-"
    const emoji = percent >= 0 ? "📈" : "📉"

    return `${emoji} **${sign}${Math.abs(percent).toFixed(2)}% Price Change**`
  }

  function itemStatus(item){
    if (!CPI_ITEMS[item] || CPI_ITEMS[item].length === 0)
      return `❌ ${item}`
    else
      return `✅ ${item}`
  }

  const basketList =
    itemStatus("Elytra")+"\n"+
    itemStatus("Enchanted Golden Apple")+"\n"+
    itemStatus("Cow Spawner")+"\n"+
    itemStatus("Sheep Spawner")+"\n"+
    itemStatus("Netherite Ingot")+"\n"+
    itemStatus("Mace")

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle("🧺 SMP Core Inflation")
    .setDescription(
      `**Tracked Basket**\n${basketList}\n\n`+
      `**Basket Value**\n$${lastAuctionBasket?.toLocaleString() || "Collecting"}`
    )
    .addFields(
      { name:"⏱ 30 Minutes", value:format(infl30) },
      { name:"🕐 1 Hour", value:format(infl60) },
      { name:"🕛 12 Hours", value:format(infl720) },
      { name:"📅 24 Hours", value:format(infl1440) }
    )
    .setFooter({ text:"InvadedLands Economy" })
    .setTimestamp()

  try{
    if(!auctionMessage)
      auctionMessage = await channel.send({embeds:[embed]})
    else
      await auctionMessage.edit({embeds:[embed]})
  }catch{
    auctionMessage = await channel.send({embeds:[embed]})
  }

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
  loadInflationData()
  startBot()
}

init()

