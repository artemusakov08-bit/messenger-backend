const path = require('path');
const fs = require('fs');

// 🔥 ЗАГРУЗКА .env САМОЙ ПЕРВОЙ
const envPath = path.resolve(__dirname, '..', '..', '.env');
console.log('📁 === ЗАГРУЗКА .env ===');
console.log('📁 Путь:', envPath);
console.log('📁 Существует?', fs.existsSync(envPath) ? '✅ ДА' : '❌ НЕТ');

require('dotenv').config({ path: envPath });

// 🔥 ПРОВЕРКА ЗАГРУЗКИ
console.log('🔑 === ПРОВЕРКА JWT_SECRET ===');
console.log('🔑 JWT_SECRET загружен?', !!process.env.JWT_SECRET);

if (process.env.JWT_SECRET) {
    console.log('🔑 Длина:', process.env.JWT_SECRET.length);
    console.log('🔑 Первые 5 символов:', process.env.JWT_SECRET.substring(0, 5) + '...');
} else {
    console.error('❌❌❌ JWT_SECRET НЕ ЗАГРУЖЕН!');
    console.error('📋 Доступные переменные окружения:');
    Object.keys(process.env).forEach(key => {
        console.error(`  ${key}: ${process.env[key] ? '****' : 'НЕТ'}`);
    });
    throw new Error('JWT_SECRET не найден в .env файле! Проверь файл .env в корне проекта.');
}

// 🔥 СОЗДАЕМ КОНСТАНТУ JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET;
console.log('✅ JWT_SECRET создан');

// 🔥 ТЕПЕРЬ ИМПОРТЫ
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { UserSecurity, VerificationCode } = require('../models');

console.log('🚀 AuthController инициализирован');

class AuthController {
    async sendVerificationCode(req, res) {
        try {
            const { phone, type = 'sms' } = req.body;
            console.log('📱 Отправка кода для:', phone);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            
            await VerificationCode.create({
                phone: phone,
                code: code,
                type: type,
                expiresInMinutes: 10
            });

            console.log('✅ Код создан:', { phone, code });

            res.json({
                success: true,
                message: 'Код подтверждения отправлен',
                code: code,
                expiresIn: 10
            });

        } catch (error) {
            console.error('❌ Ошибка отправки кода:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка отправки кода: ' + error.message 
            });
        }
    }

    async checkUserRegistration(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.body;
            console.log('🔍 Проверка регистрации:', phone);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (userResult.rows.length === 0) {
                console.log('🆕 Пользователь не найден:', phone);
                return res.status(200).json({ 
                    success: false,
                    needsRegistration: true,
                    error: 'Пользователь не найден. Требуется регистрация.' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            console.log('✅ Пользователь найден:', user.user_id);

            res.json({
                success: true,
                userExists: true,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    authLevel: user.auth_level
                },
                security: {
                    twoFAEnabled: securitySettings?.two_fa_enabled || false,
                    codeWordEnabled: securitySettings?.code_word_enabled || false,
                    securityLevel: securitySettings?.security_level || 'low'
                }
            });
        } catch (error) {
            console.error('❌ Ошибка проверки регистрации:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка проверки пользователя: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    async register(req, res) {
        const client = await db.getClient();
        try {
            const { phone, displayName, username, role = 'user' } = req.body;
            console.log('🆕 Регистрация:', { phone, displayName, username });

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            const existingUser = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует' 
                });
            }

            const timestamp = Date.now();
            const userId = 'user_' + timestamp;
            const generatedUsername = username || phone;
            const generatedDisplayName = displayName || "User " + phone.slice(-4);
            const userRole = role;
            const authLevel = 'sms_only';

            const result = await client.query(
                `INSERT INTO users (
                    user_id, phone, username, display_name, 
                    role, is_premium, is_banned, warnings, auth_level,
                    status, last_seen
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [
                    userId, 
                    phone,
                    generatedUsername, 
                    generatedDisplayName,
                    userRole,
                    false,
                    false,
                    0,
                    authLevel,
                    'offline',
                    Date.now()
                ]
            );

            const newUser = result.rows[0];
            console.log('✅ Пользователь зарегистрирован:', newUser.user_id);

            await UserSecurity.createOrUpdate(newUser.user_id);

            const tempToken = jwt.sign(
                { 
                    userId: newUser.user_id,
                    type: 'registration',
                    phone: newUser.phone
                },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.status(201).json({
                success: true,
                message: 'Пользователь успешно зарегистрирован',
                tempToken: tempToken,
                user: {
                    id: newUser.user_id,
                    phone: newUser.phone,
                    username: newUser.username,
                    displayName: newUser.display_name,
                    role: newUser.role,
                    is_premium: newUser.is_premium,
                    authLevel: newUser.auth_level
                }
            });

        } catch (error) {
            console.error('❌ Ошибка регистрации:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера при регистрации: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    async verifyCodeAndLogin(req, res) {
        const client = await db.getClient();
        try {
            console.log('🔐 === НАЧАЛО ЛОГИНА ===');
            const { phone, code, type = 'sms' } = req.body;
            console.log('📱 Данные:', { phone, code, type });

            if (!phone || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон и код обязательны' 
                });
            }

            console.log('🔍 Поиск кода для:', phone);
            const verificationCode = await VerificationCode.findOne({
                phone: phone, 
                code: code, 
                type: type
            });

            if (!verificationCode) {
                console.log('❌ Код не найден или истек');
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код подтверждения' 
                });
            }

            if (verificationCode.is_used) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Код уже использован' 
                });
            }

            if (new Date() > verificationCode.expires_at) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Код истек' 
                });
            }

            await VerificationCode.markAsUsed(verificationCode.id);

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                ['online', Date.now(), user.user_id]
            );

            console.log('🔑 Генерация токена с JWT_SECRET...');
            console.log('🔑 JWT_SECRET длина:', JWT_SECRET.length);
            
            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    role: user.role,
                    phone: user.phone
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log('✅ Логин успешен:', user.user_id);
            console.log('✅ Токен сгенерирован, длина:', token.length);

            res.json({
                success: true,
                token: token,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    status: user.status
                },
                security: {
                    twoFAEnabled: securitySettings?.two_fa_enabled || false,
                    codeWordEnabled: securitySettings?.code_word_enabled || false,
                    securityLevel: securitySettings?.security_level || 'low'
                }
            });

        } catch (error) {
            console.error('❌ Ошибка входа:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка входа: ' + error.message 
            });
        } finally {
            client.release();
        }
    }

    async verify2FACode(req, res) {
        try {
            const { userId, code } = req.body;
            console.log('🔐 Проверка 2FA:', { userId, code });

            if (!userId || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'ID пользователя и код обязательны' 
                });
            }

            const securitySettings = await UserSecurity.findByUserId(userId);

            if (!securitySettings || !securitySettings.two_fa_enabled) {
                return res.status(400).json({ 
                    success: false,
                    error: '2FA не включена для этого пользователя' 
                });
            }

            const isValid2FACode = await this.validate2FACode(securitySettings.two_fa_secret, code);

            if (!isValid2FACode) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код 2FA' 
                });
            }

            const operationToken = jwt.sign(
                { 
                    userId: userId,
                    type: '2fa_verified',
                    verifiedAt: new Date()
                },
                JWT_SECRET,
                { expiresIn: '5m' }
            );

            console.log('✅ 2FA проверка пройдена:', userId);

            res.json({
                success: true,
                operationToken: operationToken,
                message: '2FA проверка пройдена'
            });

        } catch (error) {
            console.error('❌ Ошибка проверки 2FA:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка проверки 2FA: ' + error.message 
            });
        }
    }

    async validate2FACode(secret, code) {
        try {
            const speakeasy = require('speakeasy');
            return speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: code,
                window: 2
            });
        } catch (error) {
            console.error('Ошибка валидации 2FA:', error);
            return /^\d{6}$/.test(code);
        }
    }

    async getAuthRequirements(req, res) {
        try {
            const { phone } = req.params;
            console.log('🔍 Требования аутентификации для:', phone);

            const userResult = await db.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            let requirements = ['sms'];
            
            if (securitySettings?.two_fa_enabled) {
                requirements.push('2fa');
            }

            if (user.role === 'admin' || user.role === 'super_admin') {
                requirements.push('password');
            }

            if (securitySettings?.code_word_enabled) {
                requirements.push('code_word');
            }

            res.json({
                success: true,
                role: user.role,
                requirements: requirements,
                securityLevel: securitySettings?.security_level || 'low',
                message: `Требуется ${requirements.join(', ')} аутентификация`
            });

        } catch (error) {
            console.error('❌ Ошибка получения требований:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }

    async getUserById(req, res) {   
        const client = await db.getClient();
        try {
            const { userId } = req.params;
            const userResult = await client.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден' 
                });
            }

            const user = userResult.rows[0];
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            res.json({
                success: true,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    status: user.status,
                    authLevel: user.auth_level,
                    is_premium: user.is_premium,
                    is_banned: user.is_banned,
                    warnings: user.warnings,
                    last_seen: user.last_seen
                },
                security: securitySettings ? {
                    twoFAEnabled: securitySettings.two_fa_enabled,
                    codeWordEnabled: securitySettings.code_word_enabled,
                    securityLevel: securitySettings.security_level
                } : null
            });

        } catch (error) {
            console.error('❌ Ошибка получения пользователя:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

    async cleanExpiredCodes(req, res) {
        try {
            const deletedCount = await VerificationCode.cleanExpiredCodes();
            
            res.json({
                success: true,
                message: `Удалено ${deletedCount} просроченных кодов`,
                deletedCount: deletedCount
            });

        } catch (error) {
            console.error('❌ Ошибка очистки кодов:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }
}

module.exports = new AuthController();