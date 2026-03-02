require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")

let bot
let reconnecting = false
let discordClient

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
    skipValidation: true,
    disableChatSigning: true
  })

  bot.loadPlugin(pathfinder)

  bot.once("spawn", () => {
    console.log("🌲 SMP spawned successfully")
    setTimeout(() => walkToNPC(), 6000)
  })

  bot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
    if (!raw.includes(":")) return

    const colon = raw.indexOf(":")
    let before = raw.slice(0, colon).trim()
    const chat = raw.slice(colon + 1).trim()
    if (!chat) return

    let rank = "Default"

    // Diamond rank has + prefix
    if (before.startsWith("+")) {
      rank = "Diamond"
      before = before.substring(1).trim()
    }

    const username = before.replace(/§[0-9a-fk-or]/gi, "").trim()
    if (!username) return

    console.log(`[SMP] ${username} (${rank}): ${chat}`)

    sendToDiscord({ username, rank, message: chat })
  })

  bot.on("end", () => {
    if (reconnecting) return
    reconnecting = true
    console.log("⚠ Disconnected. Reconnecting in 5s...")
    setTimeout(() => {
      reconnecting = false
      startBot()
    }, 5000)
  })

  bot.on("error", (err) => {
    console.log("❌ Bot error:", err.message)
  })
}

// ================= WALK + CLICK =================
async function walkToNPC() {
  console.log("🚶 Walking to SMP NPC...")

  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))

  bot.once("goal_reached", async () => {
    console.log("🎯 Reached SMP NPC")

    await bot.waitForTicks(20)

    const entity = bot.nearestEntity(e =>
      (e.type === "player" || e.type === "mob") &&
      bot.entity.position.distanceTo(e.position) < 6
    )

    if (!entity) {
      console.log("❌ No NPC found to click")
      return
    }

    console.log("🖱 Clicking NPC:", entity.username || entity.name)

    await bot.lookAt(entity.position.offset(0, entity.height, 0), true)
    await bot.waitForTicks(10)

    bot.activateEntity(entity)
  })
}

// ================= DISCORD SEND =================
async function sendToDiscord(data) {
  if (!process.env.DISCORD_CHANNEL_ID) {
    console.log("❌ DISCORD_CHANNEL_ID not set")
    return
  }

  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
  if (!channel) {
    console.log("❌ Could not fetch Discord channel")
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
}

// ================= START =================
async function init() {
  await startDiscord()
  startBot()
}

init()