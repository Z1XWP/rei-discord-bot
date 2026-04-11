import {
    Client, GatewayIntentBits, VoiceState, ChannelType,
    PermissionsBitField, GuildMember, Collection,
    SlashCommandBuilder, REST, Routes,
    ChatInputCommandInteraction,
    MessageFlags
} from 'discord.js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// ---------- Конфигурация (храним в файле config.json) ----------
interface BotSettings {
    createRoomChannelId: string | null;
}

const CONFIG_FILE = path.join(__dirname, '..', 'config.json'); // на уровень выше src

function loadSettings(): BotSettings {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки config.json:', error);
    }
    return { createRoomChannelId: null };
}

function saveSettings(settings: BotSettings): void {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.error('Ошибка сохранения config.json:', error);
    }
}

function setDefaultChannel(channelId: string | null): void {
    const settings = loadSettings();
    settings.createRoomChannelId = channelId;
    saveSettings(settings);
}

function getDefaultChannel(): string | null {
    return loadSettings().createRoomChannelId;
}

// ---------- Класс бота ----------
interface CreatedRoom {
    channelId: string;
    ownerId: string;
    createdAt: Date;
}

class RoomBot {
    private client: Client;
    private createdRooms: Map<string, CreatedRoom> = new Map();
    private pendingCreations: Set<string> = new Set();
    private createRoomChannelId: string | null = null;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages
            ]
        });

        this.setupEventListeners();
        this.setupErrorHandling();
    }

    private setupEventListeners(): void {
        this.client.once('ready', async () => {
            console.log(`✅ Бот ${this.client.user?.tag} запущен!`);
            // Загружаем сохранённый канал
            this.createRoomChannelId = getDefaultChannel();
            if (this.createRoomChannelId) {
                console.log(`📢 Канал для создания комнат: ${this.createRoomChannelId}`);
            } else {
                console.warn('⚠️ Канал для создания комнат не задан. Используйте /set_default_channel');
            }
            // Регистрируем слэш-команды на сервере
            await this.registerCommands();
        });

        this.client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
            if (oldState.channelId === newState.channelId) return;
            if (newState.channelId) {
                this.handlePotentialRoomCreation(newState);
            }
            this.checkAndCleanEmptyRooms(oldState);
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await this.handleCommand(interaction as ChatInputCommandInteraction);
        });

        this.client.on('error', (error: Error) => {
            console.error('❌ Ошибка Discord API:', error);
        });
    }

    private setupErrorHandling(): void {
        process.on('unhandledRejection', (error: Error) => {
            console.error('❌ Необработанное исключение:', error);
        });
    }

    // Регистрация команд через REST API
    private async registerCommands(): Promise<void> {
        const guildId = process.env.GUILD_ID;
        const token = process.env.DISCORD_TOKEN;
        const clientId = process.env.CLIENT_ID;

        if (!guildId || !token || !clientId) {
            console.warn('⚠️ GUILD_ID, DISCORD_TOKEN или CLIENT_ID не указаны в .env. Команды не зарегистрированы.');
            return;
        }

        const commands = [
            new SlashCommandBuilder()
                .setName('set_default_channel')
                .setDescription('Установить голосовой канал, при заходе в который будут создаваться приватные комнаты')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Голосовой канал')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildVoice)
                ),
            new SlashCommandBuilder()
                .setName('get_default_channel')
                .setDescription('Показать текущий канал для создания комнат')
        ].map(cmd => cmd.toJSON());

        const rest = new REST({ version: '10' }).setToken(token);

        try {
            console.log('🔄 Регистрация слэш-команд...');
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
            console.log('✅ Слэш-команды зарегистрированы!');
        } catch (error) {
            console.error('❌ Ошибка регистрации команд:', error);
        }
    }

    private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const commandName = interaction.commandName;

        if (commandName === 'set_default_channel') {
            const channel = interaction.options.get('channel')?.channel;
            if (!channel || channel.type !== ChannelType.GuildVoice) {
                await interaction.reply({ content: '❌ Пожалуйста, выберите голосовой канал.', flags: MessageFlags.Ephemeral });
                return;
            }
            setDefaultChannel(channel.id);
            this.createRoomChannelId = channel.id;
            await interaction.reply({
                content: `✅ Теперь **${channel.name}** будет использоваться как канал для создания приватных комнат.`,
                flags: MessageFlags.Ephemeral
            });
        }
        else if (commandName === 'get_default_channel') {
            const channelId = getDefaultChannel();
            if (!channelId) {
                await interaction.reply('ℹ️ Канал для создания комнат не установлен. Используйте `/set_default_channel`.');
                return;
            }
            const channel = interaction.guild?.channels.cache.get(channelId);
            if (channel) {
                await interaction.reply(`🎤 Текущий канал-родитель: **${channel.name}** (ID: ${channelId})`);
            } else {
                await interaction.reply(`⚠️ Канал с ID ${channelId} не найден на сервере. Возможно, он был удалён. Установите новый канал командой /set_default_channel.`);
            }
        }
    }

    private async handlePotentialRoomCreation(voiceState: VoiceState): Promise<void> {
        const channel = voiceState.channel;
        const member = voiceState.member;

        if (!channel || !member || channel.id !== this.createRoomChannelId) return;
        if (this.pendingCreations.has(member.id)) {
            console.log(`⚠️ Создание комнаты для ${member.user.tag} уже выполняется, пропускаем`);
            return;
        }

        this.pendingCreations.add(member.id);
        try {
            await this.createPrivateRoom(member, channel);
        } catch (error) {
            console.error('❌ Ошибка при создании комнаты:', error);
            const dmChannel = await member.createDM();
            await dmChannel.send('❌ Произошла ошибка при создании вашей комнаты. Обратитесь к администраторам.');
        } finally {
            setTimeout(() => this.pendingCreations.delete(member.id), 5000);
        }
    }

    private async createPrivateRoom(member: any, triggerChannel: any): Promise<void> {
        const guild = triggerChannel.guild;
        const memberName = member.nickname || member.user.username;
        const channelName = this.setChannelName(memberName);
        const parentCategory = triggerChannel.parent;

        console.log(`🛠️ Создание комнаты для ${memberName} (${member.id})`);

        const newChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentCategory ? parentCategory.id : null,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.Connect]
                },
                {
                    id: member.id,
                    allow: [
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.MoveMembers
                    ]
                }
            ]
        });

        await member.voice.setChannel(newChannel);

        this.createdRooms.set(newChannel.id, {
            channelId: newChannel.id,
            ownerId: member.id,
            createdAt: new Date()
        });

        console.log(`✅ Комната "${channelName}" создана (ID: ${newChannel.id})`);
    }

    private async checkAndCleanEmptyRooms(oldState: VoiceState): Promise<void> {
        const leftChannel = oldState.channel;
        if (!leftChannel || leftChannel.type !== ChannelType.GuildVoice) return;

        const roomInfo = this.createdRooms.get(leftChannel.id);
        if (!roomInfo) return;

        const members = (leftChannel.members as Collection<string, GuildMember>).filter(member => !member.user.bot);
        if (members.size === 0) {
            setTimeout(async () => {
                try {
                    const channel = await oldState.guild.channels.fetch(leftChannel.id);
                    if (channel && channel.isVoiceBased() && channel.members.filter(m => !m.user.bot).size === 0) {
                        await channel.delete('Комната опустела');
                        this.createdRooms.delete(channel.id);
                        console.log(`🗑️ Комната "${channel.name}" удалена`);
                    }
                } catch (error) {
                    console.error('❌ Ошибка при удалении комнаты:', error);
                }
            }, 5000);
        }
    }

    private setChannelName(name: string): string {
        // Задаем название канала
        return name
    }

    public async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            console.error('❌ Токен бота не найден! Проверьте файл .env');
            process.exit(1);
        }

        try {
            await this.client.login(token);
        } catch (error) {
            console.error('❌ Ошибка при входе в Discord:', error);
            process.exit(1);
        }
    }
}

const bot = new RoomBot();
bot.start();