const mongoose = require('mongoose');

const UserSecuritySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    // 2FA настройки
    twoFAEnabled: {
        type: Boolean,
        default: false
    },
    twoFASecret: {
        type: String,
        default: null
    },
    twoFATempSecret: {
        type: String,
        default: null
    },
    twoFATempSecretExpires: {
        type: Date,
        default: null
    },
    // Кодовое слово
    codeWordEnabled: {
        type: Boolean,
        default: false
    },
    codeWordHash: {
        type: String,
        default: null
    },
    codeWordHint: {
        type: String,
        default: ''
    },
    // Дополнительные пароли
    additionalPasswords: [{
        name: String,
        passwordHash: String,
        createdAt: Date
    }],
    // Доверенные устройства
    trustedDevices: [{
        deviceId: String,
        deviceName: String,
        lastUsed: Date,
        ipAddress: String
    }],
    // Уровень безопасности
    securityLevel: {
        type: String,
        enum: ['низкий', 'средний', 'высокий', 'максимальный'],
        default: 'низкий'
    },
    securityScore: {
        type: Number,
        default: 25,
        min: 0,
        max: 100
    },
    // Временные метки
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Обновляем securityScore при изменении настроек
UserSecuritySchema.pre('save', function(next) {
    let score = 25;
    
    if (this.twoFAEnabled) score += 30;
    if (this.codeWordEnabled) score += 20;
    if (this.additionalPasswords.length > 0) score += 15;
    if (this.trustedDevices.length > 0) score += 10;
    
    this.securityScore = Math.min(score, 100);
    
    // Обновляем уровень безопасности
    if (this.securityScore >= 80) this.securityLevel = 'максимальный';
    else if (this.securityScore >= 60) this.securityLevel = 'высокий';
    else if (this.securityScore >= 40) this.securityLevel = 'средний';
    else this.securityLevel = 'низкий';
    
    this.lastUpdated = Date.now();
    next();
});

module.exports = mongoose.model('UserSecurity', UserSecuritySchema);