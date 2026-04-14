import { ChatInputCommandInteraction } from 'discord.js';
import { RoomBot } from '../bot';
import { getPool } from '../db';
import { replyEphemeral } from '../utils';

// ----- Работа с БД -----

/**
 * Возвращает список ID ролей-исключений для сервера.
 * @param guildId - ID сервера
 */
export async function getExceptionRoles(guildId: string): Promise<string[]> {
    const res = await getPool().query('SELECT role_id FROM rei_data.exception_roles WHERE guild_id = $1', [guildId]);
    return res.rows.map(r => r.role_id);
}

/**
 * Добавляет роль в список исключений сервера.
 * @param guildId - ID сервера
 * @param roleId - ID роли
 * @returns true, если роль была добавлена (не существовала ранее)
 */
export async function addExceptionRole(guildId: string, roleId: string): Promise<boolean> {
    const existing = await getExceptionRoles(guildId);
    if (existing.includes(roleId)) return false;
    await getPool().query('INSERT INTO rei_data.exception_roles (guild_id, role_id) VALUES ($1, $2)', [guildId, roleId]);
    return true;
}

/**
 * Удаляет роль из списка исключений сервера.
 * @param guildId - ID сервера
 * @param roleId - ID роли
 * @returns true, если роль была удалена (существовала)
 */
export async function removeExceptionRole(guildId: string, roleId: string): Promise<boolean> {
    const res = await getPool().query('DELETE FROM rei_data.exception_roles WHERE guild_id = $1 AND role_id = $2', [guildId, roleId]);
    return (res.rowCount ?? 0) > 0;
}

// ----- Обработчики команд -----

/**
 * Обработчик команды /add_exception_role.
 * Добавляет роль, участники которой могут заходить в любые приватные комнаты.
 */
export async function handleAddExceptionRole(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const role = interaction.options.getRole('role');
    if (!role) {
        await replyEphemeral(interaction, '❌ Роль не найдена.');
        return;
    }
    const added = await addExceptionRole(guildId, role.id);
    await replyEphemeral(interaction, added ? `✅ Роль **${role.name}** добавлена.` : `⚠️ Роль уже в списке.`);
}

/**
 * Обработчик команды /remove_exception_role.
 * Удаляет роль из списка исключений.
 */
export async function handleRemoveExceptionRole(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const role = interaction.options.getRole('role');
    if (!role) {
        await replyEphemeral(interaction, '❌ Роль не найдена.');
        return;
    }
    const removed = await removeExceptionRole(guildId, role.id);
    await replyEphemeral(interaction, removed ? `✅ Роль **${role.name}** удалена.` : `⚠️ Роль не найдена в списке.`);
}

/**
 * Обработчик команды /get_exception_roles.
 * Показывает список всех ролей-исключений на сервере.
 */
export async function handleGetExceptionRoles(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const roles = await getExceptionRoles(guildId);
    if (roles.length === 0) {
        await replyEphemeral(interaction, 'ℹ️ Список ролей-исключений пуст.');
        return;
    }
    const mentions = roles.map(id => `<@&${id}>`).join(', ');
    await replyEphemeral(interaction, `🎭 **Роли-исключения:**\n${mentions}`);
}