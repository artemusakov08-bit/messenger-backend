const AuditLog = require('../../models/AuditLog');
const bcrypt = require('bcryptjs');

class SecurityAuditService {
    // Логирование действий безопасности
    static async logSecurityAction(userId, action, description, metadata = {}) {
        try {
            const auditLog = new AuditLog({
                userId,
                action,
                description,
                metadata,
                ipAddress: metadata.ipAddress || 'unknown',
                userAgent: metadata.userAgent || 'unknown',
                timestamp: new Date()
            });
            
            await auditLog.save();
            return auditLog;
        } catch (error) {
            console.error('❌ Audit log error:', error);
        }
    }

    // Хеширование кодового слова
    static async hashCodeWord(codeWord) {
        const salt = await bcrypt.genSalt(12);
        return await bcrypt.hash(codeWord, salt);
    }

    // Проверка кодового слова
    static async verifyCodeWord(codeWord, hash) {
        return await bcrypt.compare(codeWord, hash);
    }

    // Получить историю безопасности
    static async getSecurityHistory(userId, limit = 50) {
        return await AuditLog.find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
    }
}

module.exports = SecurityAuditService;