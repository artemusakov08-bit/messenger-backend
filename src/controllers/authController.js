// /app/src/controllers/authController.js
const db = require('../config/database');
const jwt = require('jsonwebtoken');
const { UserSecurity, VerificationCode } = require('../models');

class AuthController {
    async checkUserRegistration(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.body;

            console.log('🔍 Checking user registration:', { phone });

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            // Находим пользователя по телефону
            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (userResult.rows.length === 0) {
                console.log('🆕 User not found, needs registration:', phone);
                return res.status(200).json({ 
                    success: false,
                    needsRegistration: true,
                    error: 'Пользователь не найден. Требуется регистрация.' 
                });
            }

            const user = userResult.rows[0];

            // Получаем настройки безопасности через PostgreSQL
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            console.log('✅ User found:', { 
                userId: user.user_id, 
                hasSecurity: !!securitySettings
            });

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
            console.error('❌ Check user registration error:', error);
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

            console.log('🆕 Registration request:', { 
                phone, 
                displayName, 
                username, 
                role
            });

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            // Проверяем существующего пользователя
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

            // Автогенерация данных если не указаны
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
            console.log('✅ User registered:', { 
                id: newUser.user_id, 
                phone: newUser.phone,  
                username: newUser.username 
            });

            // Создаем настройки безопасности через PostgreSQL
            await UserSecurity.createOrUpdate(newUser.user_id);

            // Генерируем временный токен для завершения регистрации
            const tempToken = jwt.sign(
                { 
                    userId: newUser.user_id,
                    type: 'registration',
                    phone: newUser.phone
                },
                process.env.JWT_SECRET || 'fallback-secret',
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
            console.error('❌ Registration error:', error);
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
            const { phone, code, type = 'sms' } = req.body;

            console.log('🔐 Verifying code and login:', { phone, code, type });

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен' 
                });
            }

            if (!code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Код подтверждения обязателен' 
                });
            }

            console.log('📞 Using phone for verification:', phone);

            // Проверяем код через PostgreSQL
            const verificationCode = await VerificationCode.findValidCode(phone, code, type);

            if (!verificationCode) {
                console.log('❌ Code not found or expired for phone:', phone);
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код подтверждения' 
                });
            }

            // Помечаем код как использованный
            await VerificationCode.markAsUsed(verificationCode.id);

            // Находим пользователя по телефону
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

            // Получаем настройки безопасности через PostgreSQL
            const securitySettings = await UserSecurity.findByUserId(user.user_id);

            // Обновляем статус пользователя
            await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                ['online', Date.now(), user.user_id]
            );

            // Генерируем токен
            const token = jwt.sign(
                { 
                    userId: user.user_id, 
                    role: user.role,
                    phone: user.phone
                },
                process.env.JWT_SECRET || 'fallback-secret',
                { expiresIn: '24h' }
            );

            console.log('✅ Login successful:', { 
                userId: user.user_id, 
                phone: user.phone,
                role: user.role 
            });

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
            console.error('❌ Verify code and login error:', error);
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

            console.log('🔐 Verifying 2FA code:', { userId, code });

            if (!userId || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'ID пользователя и код обязательны' 
                });
            }

            // Получаем настройки безопасности
            const securitySettings = await UserSecurity.findOne({
                where: { userId: userId }
            });

            if (!securitySettings || !securitySettings.two_fa_enabled) {
                return res.status(400).json({ 
                    success: false,
                    error: '2FA не включена для этого пользователя' 
                });
            }

            // Проверяем код 2FA
            const isValid2FACode = await this.validate2FACode(securitySettings.two_fa_secret, code);

            if (!isValid2FACode) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код 2FA' 
                });
            }

            // Генерируем токен для операции
            const operationToken = jwt.sign(
                { 
                    userId: userId,
                    type: '2fa_verified',
                    verifiedAt: new Date()
                },
                process.env.JWT_SECRET || 'fallback-secret',
                { expiresIn: '5m' }
            );

            console.log('✅ 2FA verification successful:', { userId });

            res.json({
                success: true,
                operationToken: operationToken,
                message: '2FA проверка пройдена'
            });

        } catch (error) {
            console.error('❌ Verify 2FA code error:', error);
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
            console.error('2FA validation error:', error);
            return /^\d{6}$/.test(code);
        }
    }

    async getAuthRequirements(req, res) {
        try {
            const { phone } = req.params;
            
            console.log('🔍 Getting auth requirements for:', phone);

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
            const securitySettings = await UserSecurity.findOne({
                where: { userId: user.user_id }
            });

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
            console.error('❌ Get auth requirements error:', error);
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
            const securitySettings = await UserSecurity.findOne({
                where: { userId: user.user_id }
            });

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
            console.error('❌ Get user by ID error:', error);
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
            console.error('❌ Clean expired codes error:', error);
            res.status(500).json({ 
                success: false,
                error: error.message 
            });
        }
    }
}

module.exports = new AuthController();