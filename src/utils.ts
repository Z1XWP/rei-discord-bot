import {
    ChatInputCommandInteraction,
    MessageFlags
} from 'discord.js';

/**
 * Отправляет ephemeral ответ в команде.
 * @param interaction - объект команды
 * @param content - текст ответа
 */
export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}