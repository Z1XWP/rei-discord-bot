import {
    ChatInputCommandInteraction,
    PermissionsBitField,
    VoiceBasedChannel
} from 'discord.js';
import { RoomBot } from '../bot';
import { getPool } from '../db';
import { CreatedRoomData } from '../types';
import { replyEphemeral } from '../utils';
import { getExceptionRoles } from './roles-controller';

// ----- Работа с БД -----

/**
 * Загружает все комнаты сервера из БД.
 * @param guildId - ID сервера
 * @returns Map вида channelId -> CreatedRoomData
 */
export async function loadRooms(guildId: string): Promise<Map<string, CreatedRoomData>> {
    const res = await getPool().query('SELECT * FROM rei_data.rooms WHERE guild_id = $1', [guildId]);
    const map = new Map<string, CreatedRoomData>();
    for (const row of res.rows) {
        map.set(row.channel_id, {
            channelId: row.channel_id,
            guildId: row.guild_id,
            ownerId: row.owner_id,
            createdAt: row.created_at,
            afterRestart: row.after_restart,
        });
    }
    return map;
}

/**
 * Сохраняет или обновляет информацию о комнате в БД.
 * @param room Данные комнаты
 */
export async function saveRoom(room: CreatedRoomData): Promise<void> {
    await getPool().query(
        `INSERT INTO rei_data.rooms (channel_id, guild_id, owner_id, created_at, after_restart)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id) DO UPDATE SET
            guild_id = EXCLUDED.guild_id,
            owner_id = EXCLUDED.owner_id,
            created_at = EXCLUDED.created_at,
            after_restart = EXCLUDED.after_restart`,
        [room.channelId, room.guildId, room.ownerId, room.createdAt, room.afterRestart]
    );
}

/**
 * Удаляет запись о комнате из БД.
 * @param channelId ID голосового канала
 */
export async function deleteRoom(channelId: string): Promise<void> {
    await getPool().query('DELETE FROM rei_data.rooms WHERE channel_id = $1', [channelId]);
}

// ----- Обработчик команды -----

/**
 * Обработчик команды /update_active_channels_access.
 * Обновляет права доступа во всех активных комнатах сервера согласно текущему списку ролей-исключений.
 */
export async function handleUpdateActiveChannelsAccess(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    await replyEphemeral(interaction, '🔄 Обновляю права в комнатах...');
    let updated = 0;
    const exceptionRoles = await getExceptionRoles(guildId);
    const rooms = bot.getCreatedRooms(guildId);
    for (const [channelId, roomData] of rooms) {
        const channel = interaction.guild?.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
        if (channel?.isVoiceBased()) {
            try {
                await channel.permissionOverwrites.set([
                    { id: guildId, deny: [PermissionsBitField.Flags.Connect] },
                    { id: roomData.ownerId, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers] },
                    ...exceptionRoles.map(roleId => ({ id: roleId, allow: [PermissionsBitField.Flags.Connect] }))
                ]);
                updated++;
            } catch (error) {
                console.error(`Ошибка в ${channel.name}:`, error);
            }
        }
    }
    await interaction.editReply({ content: `✅ Обновлены права в ${updated} комнатах.` });
}