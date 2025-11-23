class RolePermissionService {
    static permissions = {
        user: ['view_profile', 'send_reports'],
        moderator: [
            'view_reports', 'respond_reports', 'temp_ban_users',
            'delete_messages', 'view_moderation_queue'
        ],
        admin: [
            'perm_ban_users', 'manage_moderators', 'view_analytics',
            'manage_templates', 'view_audit_logs'
        ],
        lead: [
            'manage_roles', 'system_config', 'manage_all_moderators',
            'access_dashboard', 'escalate_cases'
        ],
        super_admin: ['all_permissions']
    };

    static hasPermission(role, permission) {
        if (role === 'super_admin') return true;
        
        const rolePerms = this.permissions[role] || [];
        return rolePerms.includes(permission) || rolePerms.includes('all_permissions');
    }

    static getAccessLevel(role) {
        const levels = {
            'user': 1,
            'moderator': 2,
            'admin': 3,
            'lead': 4,
            'super_admin': 5
        };
        return levels[role] || 0;
    }

    static canManageRole(userRole, targetRole) {
        const userLevel = this.getAccessLevel(userRole);
        const targetLevel = this.getAccessLevel(targetRole);
        return userLevel > targetLevel;
    }
}

module.exports = RolePermissionService;