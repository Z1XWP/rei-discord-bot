import { JsonFileStorage } from './storage';
import { RoomBot } from './bot';
import { setupEvents } from './events';
import * as dotenv from 'dotenv';

dotenv.config();

const storage = new JsonFileStorage();
const bot = new RoomBot(storage);
setupEvents(bot);
bot.start().catch(err => {
    console.error('❌ Критическая ошибка:', err);
    process.exit(1);
});