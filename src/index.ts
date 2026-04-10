import { Client, GatewayIntentBits, VoiceState, ChannelType, PermissionsBitField, GuildMember, Collection } from 'discord.js';
import * as dotenv from 'dotenv';
import {CreatedRoom} from "./types/config";

dotenv.config();


class RoomBot {
    private client: Client;
    private createdRooms: Map<string, CreatedRoom> = new Map();
    private pendingCreations: Set<string> = new Set(); // Хранит ID пользователей, для которых уже создаётся комната
    private readonly CREATE_ROOM_CHANNEL_ID;

    constructor() {
        // Получаем ID канала-триггера из .env
        this.CREATE_ROOM_CHANNEL_ID = process.env.CREATE_ROOM_CHANNEL_ID;

        // Инициализируем клиент Discord с нужными интентами
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
        this.client.once('ready', () => {
            console.log(`✅ Бот ${this.client.user?.tag} запущен!`);
            console.log(`📢 Канал для создания комнат: ${this.CREATE_ROOM_CHANNEL_ID}`);
        });

        this.client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
            // Игнорируем, если ID канала не изменился
            if (oldState.channelId === newState.channelId) return;

            // Пользователь зашёл в какой-то канал (или переключился)
            if (newState.channelId) {
                this.handlePotentialRoomCreation(newState);
            }

            // Проверка на опустение канала (старый код)
            this.checkAndCleanEmptyRooms(oldState);
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

    private async handlePotentialRoomCreation(voiceState: VoiceState): Promise<void> {
        const channel = voiceState.channel;
        const member = voiceState.member;

        // Проверяем, что пользователь зашёл именно в канал "Create Room"
        if (!channel || !member || channel.id !== this.CREATE_ROOM_CHANNEL_ID) return;

        // Защита от дублирования
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
            // Снимаем блокировку через 5 секунд (на случай, если событие придёт повторно)
            setTimeout(() => this.pendingCreations.delete(member.id), 5000);
        }
    }

    private async createPrivateRoom(member: any, triggerChannel: any): Promise<void> {
        const guild = triggerChannel.guild;
        const memberName = member.nickname || member.user.username;

        // Создаем уникальное название канала
        const channelName = this.setChannelName(memberName);

        // Получаем категорию из канала-триггера
        const parentCategory = triggerChannel.parent;

        console.log(`🛠️ Создание комнаты для ${memberName} (${member.id})`);

        // Создаем новый голосовой канал
        const newChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentCategory ? parentCategory.id : null,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.Connect]
                },
                {
                    id: member.id, // Владелец комнаты
                    allow: [
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.MoveMembers
                    ]
                }
            ]
        });

        // Перемещаем пользователя в созданный канал
        await member.voice.setChannel(newChannel);

        // Сохраняем информацию о комнате
        this.createdRooms.set(newChannel.id, {
            channelId: newChannel.id,
            ownerId: member.id,
            createdAt: new Date()
        });

        console.log(`✅ Комната "${channelName}" создана (ID: ${newChannel.id})`);

       /* // Отправляем сообщение в ЛС
       try {
            const dmChannel = await member.createDM();
            await dmChannel.send(
                `🎉 Ваша приватная комната **"${channelName}"** создана!\n` +
                `🔗 Пригласить друзей: \`Кликните ПКМ по каналу → Скопировать приглашение\`\n` +
                `⚙️ Управление: Настройте права доступа через \`Настройки канала\`\n` +
                `🗑️ Комната автоматически удалится, когда все выйдут из нее.`
            );
        } catch (dmError) {
            console.log('⚠️ Не удалось отправить ЛС пользователю');
        }
        */
    }

    private async checkAndCleanEmptyRooms(oldState: VoiceState): Promise<void> {
        const leftChannel = oldState.channel;

        if (!leftChannel || leftChannel.type !== ChannelType.GuildVoice) return;

        // Проверяем, является ли это созданной нами комнатой
        const roomInfo = this.createdRooms.get(leftChannel.id);
        if (!roomInfo) return;

        // Проверяем, пуст ли канал (исключая самого бота)
        // Приводим members к Collection, так как мы точно знаем тип канала
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
        return name
    }

    public async start(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;

        if (!token) {
            console.error('❌ Токен бота не найден! Проверьте файл .env');
            process.exit(1);
        }

        if (!this.CREATE_ROOM_CHANNEL_ID) {
            console.error('❌ ID канала Create Room не найден! Проверьте файл .env');
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

// Запуск бота
const bot = new RoomBot();
bot.start();