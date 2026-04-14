import { REST, Routes, SlashCommandBuilder, ChannelType, ChatInputCommandInteraction } from 'discord.js';
import { RoomBot } from './bot';
import { handleSetDefaultChannel, handleGetDefaultChannel } from './controllers/guild-controller';
import { handleUpdateActiveChannelsAccess } from './controllers/rooms-controller';
import { handleAddExceptionRole, handleRemoveExceptionRole, handleGetExceptionRoles } from './controllers/roles-controller';

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
 * Регистрирует слэш-команды бота.
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
                .setDescription('Роль').setRequired(true)),
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

/**
 * Обработчик входящих команд.
 */
export async function handleCommand(bot: RoomBot, interaction: ChatInputCommandInteraction): Promise<void> {
    const handler = commandHandlers.get(interaction.commandName);
    if (handler) {
        await handler(bot, interaction);
    } else {
        console.warn(`❌ Неизвестная команда: ${interaction.commandName}`);
    }
}