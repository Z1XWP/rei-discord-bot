import { RoomBot } from './bot';
import { setupEvents } from './events';
import * as dotenv from 'dotenv';

dotenv.config();

const bot = new RoomBot();
setupEvents(bot);
bot.start().catch(err => {
    console.error('❌ Критическая ошибка:', err);
    process.exit(1);
});