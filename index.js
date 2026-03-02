require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")

let bot
let discordClient
let alreadyWalking = false

console.log("====================================")
console.log("Container started at:", new Date().toISOString())
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

  bot.on("kicked", reason => {
    console.log("🚫 Kicked:", reason)
  })

  bot.on("error", err => {
    console.log("❌ Error:", err.message)
  })

  bot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
    console.log("📨 RAW:", raw)

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

    console.log(`[SMP CHAT] ${username}: ${chat}`)
    sendToDiscord({ username, rank, message: chat })
  })
}

// ================= WALK + CLICK =================
async function walkToNPC() {
  if (alreadyWalking) return
  alreadyWalking = true

  console.log("🚶 Walking to SMP NPC (54 94 691)...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))

  bot.once("goal_reached", async () => {
    console.log("🎯 Reached SMP location")

    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e => {
      if (!e.position) return false
      const dist = bot.entity.position.distanceTo(e.position)
      return (
        dist < 5 &&
        (e.type === "mob" || e.type === "player")
      )
    })

    if (!entity) {
      console.log("❌ No NPC found — retrying in 5s")
      alreadyWalking = false
      return setTimeout(walkToNPC, 5000)
    }

    console.log("🖱 Clicking entity:", entity.username || entity.name)

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)
    bot.activateEntity(entity)

    console.log("✅ Clicked SMP NPC")
  })
}

// ================= DISCORD SEND =================
async function sendToDiscord(data) {
  try {
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
  } catch (err) {
    console.log("❌ Discord error:", err.message)
  }
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()