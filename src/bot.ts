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
import {
    getTriggerChannelId,
    setTriggerChannelId,
    loadRooms,
    saveRoom,
    deleteRoom,
    getExceptionRoles
} from './db';

export class RoomBot {
    private readonly client: Client;
    private roomsPerGuild: Map<string, Map<string, CreatedRoomData>> = new Map();
    private pendingCreations: Set<string> = new Set(); // "guildId:memberId"

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages
            ]
        });
    }

    public getClient(): Client {
        return this.client;
    }

    /**
     * Загружает данные для конкретного сервера (комнаты) из БД.
     */
    public async loadGuildData(guildId: string): Promise<void> {
        const rooms = await loadRooms(guildId);
        this.roomsPerGuild.set(guildId, rooms);
        console.log(`📂 Загружено ${rooms.size} комнат для сервера ${guildId}`);
    }

    /**
     * Возвращает мапу комнат для сервера.
     */
    public getCreatedRooms(guildId: string): Map<string, CreatedRoomData> {
        return this.roomsPerGuild.get(guildId) || new Map();
    }

    /**
     * Возвращает ID канала-триггера для сервера.
     */
    public async getTriggerChannelId(guildId: string): Promise<string | null> {
        return getTriggerChannelId(guildId);
    }

    /**
     * Устанавливает ID канала-триггера для сервера.
     * При сбросе ID канало-триггера удаляет все созданные ботом комнаты на этом сервере.
     */
    public async setTriggerChannelId(guildId: string, channelId: string | null): Promise<void> {
        await setTriggerChannelId(guildId, channelId);
        if (channelId === null) {
            console.log(`🗑️ Для сервера ${guildId} канал-триггер сброшен. Очищаем комнаты...`);
            await this.cleanupGuildRooms(guildId);
        } else {
            console.log(`📢 Для сервера ${guildId} установлен канал-триггер: ${channelId}`);
        }
    }

    /**
     * Удаляет все созданные ботом комнаты сервера: удаляет голосовые каналы и записи в БД.
     */
    private async cleanupGuildRooms(guildId: string): Promise<void> {
        const guild = this.client.guilds.cache.get(guildId);
        const rooms = this.getCreatedRooms(guildId);

        for (const [channelId, roomData] of rooms) {
            // Удаляем канал, если он существует
            if (guild) {
                const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
                if (channel && channel.isVoiceBased()) {
                    try {
                        await channel.delete('Канал-триггер сброшен, очистка комнат');
                        console.log(`🗑️ Комната "${channel.name}" удалена при сбросе триггера (владелец: ${roomData.ownerId}) `);
                    } catch (error) {
                        console.error(`❌ Ошибка при удалении канала ${channelId}:`, error);
                    }
                }
            }
            // Удаляем запись из БД
            await deleteRoom(channelId);
        }

        // Очищаем локальный Map
        this.roomsPerGuild.set(guildId, new Map());
        console.log(`✅ Комнаты для сервера ${guildId} очищены.`);
    }

    /**
     * Восстанавливает ранее созданные комнаты после перезапуска.
     * Удаляет записи о несуществующих комнатах и удаляет пустые комнаты.
     */
    public async restoreCreatedRooms(guildId: string): Promise<void> {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            console.warn(`⚠️ Сервер ${guildId} не найден для восстановления комнат`);
            return;
        }
        const rooms = this.getCreatedRooms(guildId);
        for (const [channelId, roomData] of rooms) {
            const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
            if (!channel) {
                // Канал удалён вручную – удаляем запись
                rooms.delete(channelId);
                await deleteRoom(channelId);
                console.log(`🗑️ Запись о комнате ${channelId} удалена (канал не существует)`);
                continue;
            }
            if (channel.type !== ChannelType.GuildVoice) continue;

            const members = (channel.members as Collection<string, GuildMember>).filter(m => !m.user.bot);
            if (members.size === 0) {
                await this.deleteEmptyRoom(channel, guildId, true);
            } else {
                console.log(`🔄 Комната "${channel.name}" восстановлена (владелец: ${roomData.ownerId})`);
            }
        }
    }

    /**
     * Обрабатывает вход пользователя в канал-триггер.
     */
    public async handlePotentialRoomCreation(voiceState: VoiceState): Promise<void> {
        const channel = voiceState.channel;
        const member = voiceState.member;
        if (!channel || !member) return;
        const guildId = member.guild.id;
        const triggerId = await this.getTriggerChannelId(guildId);
        if (channel.id !== triggerId) return;

        const key = `${guildId}:${member.id}`;
        if (this.pendingCreations.has(key)) {
            console.log(`⚠️ Создание комнаты для ${member.user.tag} уже выполняется, пропускаем`);
            return;
        }

        this.pendingCreations.add(key);
        try {
            await this.createPrivateRoom(member, channel);
        } catch (error) {
            console.error('❌ Ошибка при создании комнаты:', error);
            const dmChannel = await member.createDM();
            await dmChannel.send('❌ Произошла ошибка при создании вашей комнаты. Обратитесь к администратору.');
        } finally {
            setTimeout(() => this.pendingCreations.delete(key), 5000);
        }
    }

    /**
     * Создаёт новую приватную комнату для участника.
     */
    public async createPrivateRoom(member: GuildMember, triggerChannel: VoiceBasedChannel): Promise<void> {
        const guild = triggerChannel.guild;
        const guildId = guild.id;
        const memberName = member.nickname || member.user.username;
        const channelName = this.setChannelName(memberName);
        const parentCategory = triggerChannel.parent;
        const exceptionRoles = await getExceptionRoles(guildId);
        const roleOverwrites = exceptionRoles.map(roleId => ({
            id: roleId,
            allow: [PermissionsBitField.Flags.Connect]
        }));

        console.log(`🛠️ Создание комнаты для ${memberName} (${member.id}) на сервере ${guild.name}`);

        const botId = this.client.user?.id;
        if (!botId) {
            throw new Error('Bot user is not ready');
        }

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
                {
                    id: botId,
                    allow: [
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.MoveMembers,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                },
                ...roleOverwrites
            ]
        });

        await member.voice.setChannel(newChannel);

        const roomData: CreatedRoomData = {
            channelId: newChannel.id,
            guildId: guildId,
            ownerId: member.id,
            createdAt: new Date(),
            afterRestart: false
        };

        const guildRooms = this.roomsPerGuild.get(guildId) || new Map();
        guildRooms.set(newChannel.id, roomData);
        this.roomsPerGuild.set(guildId, guildRooms);
        await saveRoom(roomData);

        console.log(`✅ Комната "${channelName}" создана (ID: ${newChannel.id})`);
    }

    /**
     * Проверяет, пуст ли канал, и если да – удаляет его.
     */
    public async deleteEmptyRoom(channel: VoiceBasedChannel, guildId: string, afterRestart: boolean = false): Promise<void> {
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
                        const guildRooms = this.roomsPerGuild.get(guildId);
                        if (guildRooms) guildRooms.delete(freshChannel.id);
                        await deleteRoom(freshChannel.id);
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
     * Проверяет пустоту канала после выхода пользователя.
     */
    public async checkAndCleanEmptyRooms(oldState: VoiceState): Promise<void> {
        const leftChannel = oldState.channel;
        if (!leftChannel) return;
        const guildId = oldState.guild.id;
        const guildRooms = this.roomsPerGuild.get(guildId);
        if (!guildRooms) return;

        const roomInfo = guildRooms.get(leftChannel.id);
        if (!roomInfo) return;

        await this.deleteEmptyRoom(leftChannel, guildId, false);
    }

    // ----- Вспомогательные методы -----
    private setChannelName(name: string): string {
        return name
    }

    // ----- Запуск бота -----
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