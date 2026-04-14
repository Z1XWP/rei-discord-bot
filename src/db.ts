import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Возвращает пул соединений с PostgreSQL.
 * Создаёт его при первом вызове, используя переменные окружения.
 */
export function getPool(): Pool {
    if (!pool) {
        pool = new Pool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || ''),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });
    }
    return pool;
}