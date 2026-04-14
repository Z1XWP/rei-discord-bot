import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { RoomBot } from '../bot';
import { getPool } from '../db';
import { replyEphemeral } from '../utils';

// ----- Работа с БД -----

/**
 * Получает ID канала-триггера для указанного сервера.
 * @param guildId - ID сервера
 * @returns ID канала или null, если не задан
 */
export async function getTriggerChannelId(guildId: string): Promise<string | null> {
    const res = await getPool().query(
        'SELECT trigger_channel_id FROM rei_data.guild_settings WHERE guild_id = $1',
        [guildId]
    );
    return res.rows[0]?.trigger_channel_id || null;
}

/**
 * Устанавливает или удаляет ID канала-триггера для сервера.
 * @param guildId - ID сервера
 * @param channelId ID канала или null для удаления
 */
export async function setTriggerChannelId(guildId: string, channelId: string | null): Promise<void> {
    if (channelId === null) {
        await getPool().query('DELETE FROM rei_data.guild_settings WHERE guild_id = $1', [guildId]);
    } else {
        await getPool().query(
            `INSERT INTO rei_data.guild_settings (guild_id, trigger_channel_id)
             VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET trigger_channel_id = EXCLUDED.trigger_channel_id`,
            [guildId, channelId]
        );
    }
}

// ----- Обработчики команд -----

/**
 * Обработчик команды /set_default_channel.
 * Устанавливает голосовой канал, вход в который создаёт приватные комнаты.
 */
export async function handleSetDefaultChannel(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const channel = interaction.options.get('channel')?.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        await replyEphemeral(interaction, '❌ Выберите голосовой канал.');
        return;
    }
    await setTriggerChannelId(guildId, channel.id);
    await bot.setTriggerChannelId(guildId, channel.id);
    await replyEphemeral(interaction, `✅ Теперь **${channel.name}** — канал для создания комнат на этом сервере.`);
}

/**
 * Обработчик команды /get_default_channel.
 * Показывает текущий канал-триггер для сервера.
 */
export async function handleGetDefaultChannel(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const channelId = await getTriggerChannelId(guildId);
    if (!channelId) {
        await interaction.reply('ℹ️ Канал не установлен. Используйте `/set_default_channel`.');
        return;
    }
    const channel = interaction.guild?.channels.cache.get(channelId);
    if (channel) {
        await interaction.reply(`🎤 Текущий канал: **${channel.name}**`);
    } else {
        await interaction.reply(`⚠️ Канал с ID ${channelId} не найден. Установите новый.`);
    }
}