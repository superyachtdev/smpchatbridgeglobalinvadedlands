require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")

let bot
let discordClient

console.log("====================================")
console.log("Container started at:", new Date().toISOString())
console.log("Process PID:", process.pid)
console.log("====================================")

// ================= DISCORD =================
async function startDiscord() {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)
}

// ================= MINECRAFT BOT =================
function startBot() {
  console.log("====================================")
  console.log("🚀 Starting SMP Bot...")
  console.log("Using MC account:", process.env.MC_USERNAME)
  console.log("Auth folder: /app/auth_cache")
  console.log("====================================")

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

  bot.on("login", () => {
    console.log("✅ Minecraft login successful")
    console.log("Logged in as:", bot.username)
  })

  bot.on("spawn", () => {
    console.log("🌲 SMP spawned successfully")
    setTimeout(() => walkToNPC(), 6000)
  })

  bot.on("kicked", (reason) => {
    console.log("🚫 Kicked:", reason)
  })

  bot.on("error", (err) => {
    console.log("❌ Bot error:", err.message)
  })

  bot.on("end", () => {
    console.log("⚠ Connection ended")
  })

  // ================= CHAT DEBUG =================
  bot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()

    // 🔥 SHOW EVERYTHING SMP SENDS
    console.log("📨 RAW MESSAGE:", raw)

    // Only continue if it looks like player chat
    if (!raw.includes(":")) return

    const colon = raw.indexOf(":")
    let before = raw.slice(0, colon).trim()
    const chat = raw.slice(colon + 1).trim()

    if (!chat) return

    let rank = "Default"

    // Diamond rank detection
    if (before.startsWith("+")) {
      rank = "Diamond"
      before = before.substring(1).trim()
    }

    const username = before
      .replace(/§[0-9a-fk-or]/gi, "")
      .replace(/&[0-9a-fk-or]/gi, "")
      .trim()

    if (!username) return

    console.log(`[SMP CHAT DETECTED] ${username} (${rank}): ${chat}`)

    sendToDiscord({ username, rank, message: chat })
  })
}

// ================= WALK =================
async function walkToNPC() {
  console.log("🚶 Walking to SMP NPC...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))
}

// ================= DISCORD SEND =================
async function sendToDiscord(data) {
  try {
    if (!process.env.DISCORD_CHANNEL_ID) {
      console.log("❌ DISCORD_CHANNEL_ID not set")
      return
    }

    const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)

    if (!channel) {
      console.log("❌ Channel not found")
      return
    }

    const colors = {
      Default: 0xAAAAAA,
      Diamond: 0x00FFFF
    }

    const embed = new EmbedBuilder()
      .setColor(colors[data.rank] || 0xAAAAAA)
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

    console.log("✅ Sent to Discord successfully")

  } catch (err) {
    console.log("❌ Discord send error:", err.message)
  }
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()