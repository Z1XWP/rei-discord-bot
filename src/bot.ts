import {
    Client,
    GatewayIntentBits,
    VoiceState,
    ChannelType,
    PermissionsBitField,
    GuildMember,
    Collection,
    VoiceBasedChannel
} from 'discord.js';
import { CreatedRoomData } from './types';
import { IRoomStorage } from './storage';
import { loadExceptionRoles } from './utils';

export class RoomBot {
    private readonly client: Client;
    private createdRooms: Map<string, CreatedRoomData> = new Map();
    private readonly storage: IRoomStorage;
    private pendingCreations: Set<string> = new Set();
    private createRoomChannelId: string | null = null;

    constructor(storage: IRoomStorage) {
        this.storage = storage;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages
            ]
        });
    }

    // ----- Геттеры для доступа из событий и команд -----
    public getClient(): Client {
        return this.client;
    }

    public getCreatedRooms(): Map<string, CreatedRoomData> {
        return this.createdRooms;
    }

    public setCreateRoomChannelId(id: string | null): void {
        this.createRoomChannelId = id;
    }

    // ----- Загрузка / восстановление -----
    /**
     * Загружает список созданных комнат из хранилища.
     */
    public async loadRoomsFromStorage(): Promise<void> {
        this.createdRooms = await this.storage.load();
        console.log(`📂 Загружено ${this.createdRooms.size} комнат из хранилища`);
    }

    /**
     * Восстанавливает информацию о комнатах после перезапуска
     */
    public async restoreCreatedRooms(): Promise<void> {
        const guild = this.client.guilds.cache.first();
        if (!guild) {
            console.warn('⚠️ Сервер не найден для восстановления комнат');
            return;
        }

        for (const [channelId, roomData] of this.createdRooms) {
            const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
            if (!channel) {
                this.createdRooms.delete(channelId);
                await this.storage.delete(channelId);
                console.log(`🗑️ Запись о комнате ${channelId} удалена (канал не существует)`);
                continue;
            }
            if (channel.type !== ChannelType.GuildVoice) continue;

            const members = (channel.members as Collection<string, GuildMember>).filter(m => !m.user.bot);
            if (members.size === 0) {
                await this.deleteEmptyRoom(channel, true);
            } else {
                console.log(`🔄 Комната "${channel.name}" восстановлена (владелец: ${roomData.ownerId})`);
            }
        }
    }

    // ----- Обработка голосовых событий -----
    /**
     * Обрабатывает вход пользователя в канал-триггер.
     * @param voiceState - новое состояние голосового канала
     */
    public async handlePotentialRoomCreation(voiceState: VoiceState): Promise<void> {
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
            await dmChannel.send('❌ Произошла ошибка при создании вашей комнаты. Обратитесь к администратору.');
        } finally {
            setTimeout(() => this.pendingCreations.delete(member.id), 5000);
        }
    }

    /**
     * Создаёт новую приватную комнату для участника.
     * @param member - участник, для которого создаётся комната
     * @param triggerChannel - канал-триггер
     */
    public async createPrivateRoom(member: GuildMember, triggerChannel: VoiceBasedChannel): Promise<void> {
        const guild = triggerChannel.guild;
        const memberName = member.nickname || member.user.username;
        const channelName = this.setChannelName(memberName);
        const parentCategory = triggerChannel.parent;
        const exceptionRoles = loadExceptionRoles();
        const roleOverwrites = exceptionRoles.map(roleId => ({
            id: roleId,
            allow: [PermissionsBitField.Flags.Connect]
        }));

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
                },
                ...roleOverwrites
            ]
        });

        await member.voice.setChannel(newChannel);

        this.createdRooms.set(newChannel.id, {
            channelId: newChannel.id,
            ownerId: member.id,
            createdAt: new Date(),
            afterRestart: false
        });
        const roomData = this.createdRooms.get(newChannel.id);
        if (roomData) {
            await this.storage.add(roomData);
        }

        console.log(`✅ Комната "${channelName}" создана (ID: ${newChannel.id})`);
    }

    /**
     * Проверяет, пуст ли канал, и если да — удаляет его.
     * @param channel - голосовой канал
     * @param afterRestart - если true, удаляет мгновенно, иначе через 5 секунд
     */
    public async deleteEmptyRoom(channel: VoiceBasedChannel, afterRestart: boolean = false): Promise<void> {
        if (!channel || channel.type !== ChannelType.GuildVoice) return;

        const members = (channel.members as Collection<string, GuildMember>).filter(m => !m.user.bot);
        if (members.size !== 0) return;

        const deleteAction = async () => {
            try {
                const freshChannel = await channel.guild.channels.fetch(channel.id);
                if (freshChannel && freshChannel.isVoiceBased()) {
                    const freshMembers = (freshChannel.members as Collection<string, GuildMember>).filter(m => !m.user.bot);
                    if (freshMembers.size === 0) {
                        const reason = afterRestart
                            ? 'Пустая комната найденная после рестарта бота'
                            : 'Пустая комната';
                        await freshChannel.delete(reason);
                        this.createdRooms.delete(freshChannel.id);
                        await this.storage.delete(freshChannel.id);
                        console.log(`🗑️ Комната "${freshChannel.name}" удалена`);
                    }
                }
            } catch (error) {
                console.error('❌ Ошибка при удалении комнаты:', error);
            }
        };

        if (afterRestart) {
            await deleteAction();
        } else {
            setTimeout(() => deleteAction().catch(err => console.error('Ошибка в таймауте удаления:', err)), 5000);
        }
    }

    /**
     * Проверяет, не опустел ли канал после выхода пользователя, и при необходимости удаляет его.
     * @param oldState - состояние голосового канала до изменения
     */
    public async checkAndCleanEmptyRooms(oldState: VoiceState): Promise<void> {
        const leftChannel = oldState.channel;
        if (!leftChannel) return;

        const roomInfo = this.createdRooms.get(leftChannel.id);
        if (!roomInfo) return;

        await this.deleteEmptyRoom(leftChannel, false);
    }

    // ----- Вспомогательные методы -----
    /**
     * Возвращает имя канала.
     * @param name - исходное имя (ник пользователя)
     */
    private setChannelName(name: string): string {
        return name
    }

    // ----- Запуск бота -----
    /**
     * Запускает бота, выполняя логин в Discord.
     */
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