import { CreatedRoomData } from '../types/config';

export interface IRoomStorage {
    load(): Promise<Map<string, CreatedRoomData>>;
    save(rooms: Map<string, CreatedRoomData>): Promise<void>;
    add(room: CreatedRoomData): Promise<void>;
    delete(channelId: string): Promise<void>;
}