import fs from 'fs';
import path from 'path';

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