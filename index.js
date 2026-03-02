require("dotenv").config()

const mineflayer = require("mineflayer")
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder")
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const path = require("path")

let bot
let reconnecting = false
let discordClient

async function startDiscord() {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds]
  })

  await discordClient.login(process.env.DISCORD_TOKEN)
  console.log("🤖 Discord connected:", discordClient.user.tag)
}

function startBot() {
  bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    auth: "microsoft",
    version: "1.20.1",
    profilesFolder: path.join(__dirname, "auth_cache"),
    skipValidation: true,
    disableChatSigning: true
  })

  bot.loadPlugin(pathfinder)

  bot.once("spawn", () => {
    console.log("🌲 SMP spawned")
    setTimeout(() => walkToNPC(), 6000)
  })

  bot.on("message", (jsonMsg) => {
    const raw = jsonMsg.toString().trim()
    if (!raw.includes(":")) return

    const colon = raw.indexOf(":")
    let before = raw.slice(0, colon).trim()
    const chat = raw.slice(colon + 1).trim()

    let rank = "Default"
    if (before.startsWith("+")) {
      rank = "Diamond"
      before = before.substring(1).trim()
    }

    const username = before.replace(/§[0-9a-fk-or]/gi, "")

    sendToDiscord({ username, rank, message: chat })
  })

  bot.on("end", () => {
    if (reconnecting) return
    reconnecting = true
    setTimeout(() => {
      reconnecting = false
      startBot()
    }, 5000)
  })
}

async function walkToNPC() {
  const mcData = require("minecraft-data")(bot.version)
  bot.pathfinder.setMovements(new Movements(bot, mcData))
  bot.pathfinder.setGoal(new goals.GoalBlock(54, 94, 691))
}

async function sendToDiscord(data) {
  const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID)
  if (!channel) return

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
    .addFields({ name: "🏷 Rank", value: `\`${data.rank}\``, inline: true })
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

async function init() {
  await startDiscord()
  startBot()
}

init()