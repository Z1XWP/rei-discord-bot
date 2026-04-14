import { VoiceState, Interaction } from 'discord.js';
import { RoomBot } from './bot';
import { registerCommands, handleCommand } from './commands';

export function setupEvents(bot: RoomBot): void {
    const client = bot.getClient();
    client.once('clientReady', async () =>
        await onReady(bot));
    client.on('voiceStateUpdate', async (oldState, newState) =>
        await onVoiceStateUpdate(bot, oldState, newState));
    client.on('interactionCreate', async (interaction) =>
        await onInteractionCreate(bot, interaction));
    client.on('error', onError);
}

async function onReady(bot: RoomBot): Promise<void> {
    const client = bot.getClient();
    console.log(`✅ Бот ${client.user?.tag} запущен!`);

    // Загружаем данные для каждого сервера, где есть бот
    for (const guild of client.guilds.cache.values()) {
        await bot.loadGuildData(guild.id);
        await bot.restoreCreatedRooms(guild.id);
        const triggerId = await bot.getTriggerChannelId(guild.id);
        if (triggerId) {
            try {
                const trigger = await guild.channels.fetch(triggerId);
                if (trigger?.isVoiceBased()) {
                    console.log(`📢 [${guild.name}] Канал-триггер: ${trigger.name}`);
                } else {
                    console.log(`⚠️ [${guild.name}] Канал-триггер не является голосовым.`);
                    await bot.setTriggerChannelId(guild.id, null);
                }
            } catch {
                console.warn(`⚠️ [${guild.name}] Канал ${triggerId} не найден. Комнаты не будут создаваться.`);
                await bot.setTriggerChannelId(guild.id, null);
            }
        } else {
            console.log(`ℹ️ [${guild.name}] Канал-триггер не задан. Используйте /set_default_channel`);
        }
    }

    // Регистрируем команды
    await registerCommands();
}

async function onVoiceStateUpdate(bot: RoomBot, oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    if (newState.channelId) await bot.handlePotentialRoomCreation(newState);
    await bot.checkAndCleanEmptyRooms(oldState);
}

async function onInteractionCreate(bot: RoomBot, interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(bot, interaction);
}

function onError(error: Error): void {
    console.error('❌ Ошибка Discord API:', error);
}