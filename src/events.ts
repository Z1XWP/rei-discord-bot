import { VoiceState, Interaction } from 'discord.js';
import { RoomBot } from './bot';
import { registerCommands, handleCommand } from './commands';
import { getDefaultChannel } from './utils';

export function setupEvents(bot: RoomBot): void {
    const client = bot.getClient();
    client.once('ready', async () => await onReady(bot));
    client.on('voiceStateUpdate', async (oldState, newState) => await onVoiceStateUpdate(bot, oldState, newState));
    client.on('interactionCreate', async (interaction) => await onInteractionCreate(bot, interaction));
    client.on('error', onError);
}

async function onReady(bot: RoomBot): Promise<void> {
    const client = bot.getClient();
    console.log(`✅ Бот ${client.user?.tag} запущен!`);
    const channelId = getDefaultChannel();
    bot.setCreateRoomChannelId(channelId);
    await bot.loadRoomsFromStorage();
    await bot.restoreCreatedRooms();
    if (channelId) {
        const guild = client.guilds.cache.first();
        if (guild) {
            try {
                const trigger = await guild.channels.fetch(channelId);
                if (trigger?.isVoiceBased()){
                    console.log(`📢 Канал-триггер: ${trigger.name}`);
                }
                else {
                    console.log('Выбранный канал не является голосовым каналом');
                }
            } catch {
                console.warn(`⚠️ Канал ${channelId} не найден. Комнаты не будут создаваться.`);
                bot.setCreateRoomChannelId(null);
            }
        }
    } else {
        console.warn('⚠️ Канал-триггер не задан. Используйте /set_default_channel');
    }
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