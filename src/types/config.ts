export interface BotConfig {
    token: string;
    clientId: string;
    guildId: string;
    createRoomChannelId: string;
}

export interface RoomData {
    channelId: string;
    ownerId: string;
    ownerName: string;
    createdAt: Date;
    members: string[];
}

export interface CreatedRoom {
    channelId: string;
    ownerId: string;
    createdAt: Date;
}