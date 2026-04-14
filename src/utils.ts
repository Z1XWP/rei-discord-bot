import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

/**
 * Вспомогательная утилита для ответов в командах. Позволяет отправить ephemeral сообщение.
 */
export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}