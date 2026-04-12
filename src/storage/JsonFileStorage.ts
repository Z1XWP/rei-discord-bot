import fs from 'fs/promises';
import path from 'path';
import { IRoomStorage } from './IRoomStorage';
import { CreatedRoomData } from '../types/config';

const ROOMS_FILE = path.join(process.cwd(), 'rooms.json');

export class JsonFileStorage implements IRoomStorage {
    async load(): Promise<Map<string, CreatedRoomData>> {
        try {
            const data = await fs.readFile(ROOMS_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            const rooms = new Map<string, CreatedRoomData>();
            for (const [id, room] of Object.entries(parsed)) {
                const r = room as any;
                rooms.set(id, {
                    channelId: r.channelId,
                    ownerId: r.ownerId,
                    createdAt: new Date(r.createdAt),
                    afterRestart: r.afterRestart
                });
            }
            return rooms;
        } catch (error: any) {
            if (error.code === 'ENOENT') return new Map();
            console.error('Ошибка загрузки rooms.json:', error);
            return new Map();
        }
    }

    async save(rooms: Map<string, CreatedRoomData>): Promise<void> {
        const data = Object.fromEntries(rooms);
        await fs.writeFile(ROOMS_FILE, JSON.stringify(data, null, 2));
    }

    async add(room: CreatedRoomData): Promise<void> {
        const rooms = await this.load();
        rooms.set(room.channelId, room);
        await this.save(rooms);
    }

    async delete(channelId: string): Promise<void> {
        const rooms = await this.load();
        if (rooms.delete(channelId)) {
            await this.save(rooms);
        }
    }
}