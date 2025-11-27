const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    username: { 
        type: String, 
        required: false,
        unique: true,
        sparse: true
    },
    displayName: { type: String, required: true },
    password: { 
        type: String, 
        required: false  // 🔥 МЕНЯЕМ НА false - пароль опциональный
    },
    role: { 
        type: String, 
        enum: ['user', 'moderator', 'admin', 'lead', 'super_admin'],
        default: 'user'
    },
    isPremium: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    banExpires: Date,
    warnings: { type: Number, default: 0 },
    authLevel: {
        type: String,
        enum: ['sms_only', 'sms_password', 'sms_password_secret', 'sms_password_secret_extra'],
        default: 'sms_only'
    }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    // 🔥 ХЭШИРУЕМ ПАРОЛЬ ТОЛЬКО ЕСЛИ ОН ЕСТЬ
    if (this.isModified('password') && this.password) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

userSchema.methods.comparePassword = async function(password) {
    // 🔥 ЕСЛИ ПАРОЛЯ НЕТ - ВОЗВРАЩАЕМ FALSE
    if (!this.password) return false;
    return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);