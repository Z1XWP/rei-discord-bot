export interface CreatedRoomData {
    guildId: string;
    channelId: string;
    ownerId: string;
    createdAt: Date;
    afterRestart: boolean;
}