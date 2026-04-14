import { Pool } from 'pg';
import { CreatedRoomData } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
    if (!pool) {
        pool = new Pool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || 'null'),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });
    }
    return pool;
}

// ----- guild_settings (канал-триггер для каждого сервера) -----
export async function getTriggerChannelId(guildId: string): Promise<string | null> {
    const res = await getPool().query(
        'SELECT trigger_channel_id FROM rei_data.guild_settings WHERE guild_id = $1', [guildId]
    );
    return res.rows[0]?.trigger_channel_id || null;
}

export async function setTriggerChannelId(guildId: string, channelId: string | null): Promise<void> {
    if (channelId === null) {
        await getPool().query('DELETE FROM rei_data.guild_settings WHERE guild_id = $1', [guildId]);
    } else {
        await getPool().query(
            `INSERT INTO rei_data.guild_settings (guild_id, trigger_channel_id)
                VALUES ($1, $2)
                    ON CONFLICT (guild_id) DO UPDATE SET trigger_channel_id = EXCLUDED.trigger_channel_id`, [guildId, channelId]
        );
    }
}

// ----- rooms -----
export async function loadRooms(guildId: string): Promise<Map<string, CreatedRoomData>> {
    const res = await getPool().query('SELECT * FROM rei_data.rooms WHERE guild_id = $1', [guildId]);
    const map = new Map<string, CreatedRoomData>();
    for (const row of res.rows) {
        map.set(row.channel_id, {
            channelId: row.channel_id,
            guildId: row.guild_id,
            ownerId: row.owner_id,
            createdAt: row.created_at,
            afterRestart: row.after_restart,
        });
    }
    return map;
}

export async function saveRoom(room: CreatedRoomData): Promise<void> {
    await getPool().query(
        `INSERT INTO rei_data.rooms (channel_id, guild_id, owner_id, created_at, after_restart)
                         VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (channel_id) DO UPDATE SET
                                guild_id = EXCLUDED.guild_id,
                                owner_id = EXCLUDED.owner_id,
                                created_at = EXCLUDED.created_at,
                                after_restart = EXCLUDED.after_restart`,
        [room.channelId, room.guildId, room.ownerId, room.createdAt, room.afterRestart]
    );
}

export async function deleteRoom(channelId: string): Promise<void> {
    await getPool().query('DELETE FROM rei_data.rooms WHERE channel_id = $1', [channelId]);
}

// ----- exception_roles -----
export async function getExceptionRoles(guildId: string): Promise<string[]> {
    const res = await getPool().query('SELECT role_id FROM rei_data.exception_roles WHERE guild_id = $1', [guildId]);
    return res.rows.map(r => r.role_id);
}

export async function addExceptionRole(guildId: string, roleId: string): Promise<boolean> {
    const existing = await getExceptionRoles(guildId);
    if (existing.includes(roleId)) return false;
    await getPool().query('INSERT INTO rei_data.exception_roles (guild_id, role_id) VALUES ($1, $2)', [guildId, roleId]);
    return true;
}

export async function removeExceptionRole(guildId: string, roleId: string): Promise<boolean> {
    const res = await getPool().query('DELETE FROM rei_data.exception_roles WHERE guild_id = $1 AND role_id = $2', [guildId, roleId]);
    return (res.rowCount ?? 0) > 0;
}