import fs from 'fs';
import path from 'path';
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BotSettings } from './types';

// ----- config.json (канал-триггер) -----
const CONFIG_FILE = path.join(process.cwd(), 'config.json');

export function loadSettings(): BotSettings {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Ошибка загрузки config.json:', error);
    }
    return { createRoomChannelId: null };
}

export function saveSettings(settings: BotSettings): void {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.error('Ошибка сохранения config.json:', error);
    }
}

export function setDefaultChannel(channelId: string | null): void {
    const settings = loadSettings();
    settings.createRoomChannelId = channelId;
    saveSettings(settings);
}

export function getDefaultChannel(): string | null {
    return loadSettings().createRoomChannelId;
}

// ----- exception-roles.json (роли-исключения) -----
const EXCEPTION_ROLES_FILE = path.join(process.cwd(), 'exception-roles.json');

export function loadExceptionRoles(): string[] {
    try {
        if (fs.existsSync(EXCEPTION_ROLES_FILE)) {
            const data = fs.readFileSync(EXCEPTION_ROLES_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed.roles || [];
        }
    } catch (error) {
        console.error('Ошибка загрузки exception-roles.json:', error);
    }
    return [];
}

export function saveExceptionRoles(roles: string[]): void {
    try {
        fs.writeFileSync(EXCEPTION_ROLES_FILE, JSON.stringify({ roles }, null, 2));
    } catch (error) {
        console.error('Ошибка сохранения exception-roles.json:', error);
    }
}

export function addExceptionRole(roleId: string): boolean {
    const roles = loadExceptionRoles();
    if (roles.includes(roleId)) return false;
    roles.push(roleId);
    saveExceptionRoles(roles);
    return true;
}

export function removeExceptionRole(roleId: string): boolean {
    const roles = loadExceptionRoles();
    const index = roles.indexOf(roleId);
    if (index === -1) return false;
    roles.splice(index, 1);
    saveExceptionRoles(roles);
    return true;
}

/**
 * Вспомогательная утилита для ответов в командах. Позволяет отправить в ответ ephemeral сообщение
 */
export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}