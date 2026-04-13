export interface BotSettings {
    createRoomChannelId: string | null;
}

export interface CreatedRoomData {
    channelId: string;
    ownerId: string;
    createdAt: Date;
    afterRestart: boolean;
}