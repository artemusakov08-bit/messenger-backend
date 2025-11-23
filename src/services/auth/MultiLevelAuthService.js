const User = require('../../models/User');

class MultiLevelAuthService {
    static authRequirements = {
        'user': ['sms'],
        'moderator': ['sms', 'password'],
        'admin': ['sms', 'password', 'secretWord'],
        'lead': ['sms', 'password', 'secretWord', 'extraPassword'],
        'super_admin': ['sms', 'password', 'secretWord', 'extraPassword']
    };

    static validateAuthLevel(role, authData) {
        const requirements = this.authRequirements[role] || [];
        
        for (const requirement of requirements) {
            if (!authData[requirement]) {
                return false;
            }
        }
        return true;
    }

    static async verifySMS(userId, smsCode) {
        // Здесь логика проверки SMS кода
        return true;
    }

    static async verifyPassword(userId, password) {
        const user = await User.findById(userId);
        return user && await user.comparePassword(password);
    }

    static async verifySecretWord(role, secretWord) {
        const secretWords = {
            'admin': process.env.ADMIN_SECRET_WORD,
            'lead': process.env.LEAD_SECRET_WORD,
            'super_admin': process.env.SUPER_ADMIN_SECRET_WORD
        };
        return secretWords[role] === secretWord;
    }

    static async verifyExtraPassword(role, extraPassword) {
        const extraPasswords = {
            'lead': process.env.LEAD_EXTRA_PASSWORD,
            'super_admin': process.env.SUPER_ADMIN_EXTRA_PASSWORD
        };
        return extraPasswords[role] === extraPassword;
    }
}

module.exports = MultiLevelAuthService;