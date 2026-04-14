import {
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    ChatInputCommandInteraction,
    PermissionsBitField,
    VoiceBasedChannel
} from 'discord.js';
import { RoomBot } from './bot';
import { addExceptionRole, removeExceptionRole, getExceptionRoles } from './db';
import { replyEphemeral } from './utils';

type CommandHandler = (bot: RoomBot, interaction: ChatInputCommandInteraction) => Promise<void>;

const commandHandlers = new Map<string, CommandHandler>([
    ['set_default_channel', handleSetDefaultChannel],
    ['get_default_channel', handleGetDefaultChannel],
    ['add_exception_role', handleAddExceptionRole],
    ['remove_exception_role', handleRemoveExceptionRole],
    ['get_exception_roles', handleGetExceptionRoles],
    ['update_active_channels_access', handleUpdateActiveChannelsAccess],
]);

/**
 * Регистрация глобальных команд (для всех серверов, где есть бот).
 */
export async function registerCommands(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!token || !clientId) {
        console.warn('⚠️ DISCORD_TOKEN или CLIENT_ID не указаны в .env. Команды не зарегистрированы.');
        return;
    }

    const commandsData = [
        new SlashCommandBuilder()
            .setName('set_default_channel')
            .setDescription('Установить голосовой канал для создания приватных комнат')
            .addChannelOption(opt => opt.setName('channel')
                .setDescription('Голосовой канал')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice)),
        new SlashCommandBuilder()
            .setName('get_default_channel')
            .setDescription('Показать текущий канал для создания приватных комнат'),
        new SlashCommandBuilder()
            .setName('add_exception_role')
            .setDescription('Добавить роль в список исключений')
            .addRoleOption(opt => opt.setName('role')
                .setDescription('Роль')
                .setRequired(true)),
        new SlashCommandBuilder()
            .setName('remove_exception_role')
            .setDescription('Удалить роль из списка исключений')
            .addRoleOption(opt => opt.setName('role')
                .setDescription('Роль').setRequired(true)),
        new SlashCommandBuilder()
            .setName('get_exception_roles')
            .setDescription('Показать список ролей-исключений'),
        new SlashCommandBuilder()
            .setName('update_active_channels_access')
            .setDescription('Обновить права во всех активных комнатах по текущему списку ролей')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('🔄 Регистрация слэш-команд...');
        await rest.put(Routes.applicationCommands(clientId), { body: commandsData });
        console.log('✅ Слэш-команды зарегистрированы!');
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
}

export async function handleCommand(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const handler = commandHandlers.get(interaction.commandName);
    if (handler) {
        await handler(bot, interaction);
    } else {
        console.warn(`❌ Неизвестная команда: ${interaction.commandName}`);
    }
}

// ----- Реализации команд (с учётом guildId) -----
async function handleSetDefaultChannel(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
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
    await bot.setTriggerChannelId(guildId, channel.id);
    await replyEphemeral(interaction, `✅ Теперь **${channel.name}** — канал для создания комнат на этом сервере.`);
}

async function handleGetDefaultChannel(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply('❌ Команда доступна только на сервере.');
        return;
    }
    const channelId = await _bot.getTriggerChannelId(guildId);
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

async function handleAddExceptionRole(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
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

async function handleRemoveExceptionRole(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
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

async function handleGetExceptionRoles(_bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
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

async function handleUpdateActiveChannelsAccess(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
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
            } catch (error) { console.error(`Ошибка в ${channel.name}:`, error); }
        }
    }
    await interaction.editReply({ content: `✅ Обновлены права в ${updated} комнатах.` });
}