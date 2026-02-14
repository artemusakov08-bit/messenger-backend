const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { UserSecurity, VerificationCode, Session } = require('../models');
const jwtUtils = require('../utils/jwtUtils');
const SessionService = require('../services/sessionService');
const User = require('../models/User');

console.log('🔑 === ИНИЦИАЛИЗАЦИЯ AUTH CONTROLLER ===');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('❌ ОШИБКА: JWT_SECRET не найден в переменных окружения Render');
    throw new Error('JWT_SECRET не настроен в Render Environment Variables');
}

console.log('✅ JWT_SECRET загружен');

class AuthController {
    // 📱 Отправка SMS кода
    async sendVerificationCode(req, res) {
    try {
        let { phone, type = 'sms' } = req.body;
        console.log('📱 Отправка кода для:', phone);

        if (!phone) {
            return res.status(400).json({ 
                success: false,
                error: 'Телефон обязателен',
                code: 'PHONE_REQUIRED'
            });
        }

        // 🔥 НОРМАЛИЗУЕМ НОМЕР — убираем +
        const cleanPhone = phone.replace('+', '');
        console.log('📱 Нормализованный номер:', cleanPhone);

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        const client = await db.getClient();
        try {
            // Удаляем старые коды
            await client.query(
                'DELETE FROM verification_codes WHERE phone = $1',
                [cleanPhone]  // ← используем cleanPhone
            );

            const codeId = 'code_' + Date.now();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            
            await client.query(
                `INSERT INTO verification_codes (id, phone, code, type, expires_at, created_at, is_used)
                 VALUES ($1, $2, $3, $4, $5, NOW(), false)`,
                [codeId, cleanPhone, code, type, expiresAt]  // ← cleanPhone
            );
            
            console.log('✅ Код сохранен в БД:', { phone: cleanPhone, code, expiresAt });
            
            // Для тестирования возвращаем код
            res.json({
                success: true,
                message: 'Код подтверждения отправлен',
                code: code,
                expiresIn: 10
            });
            
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Ошибка отправки кода:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка отправки кода: ' + error.message,
            code: 'SEND_CODE_ERROR'
        });
    }
}
}

    // 🔐 Проверка кода и создание сессии (ОБНОВЛЕННЫЙ)
    async verifyCodeAndLogin(req, res) {
        const client = await db.getClient();
        try {
            console.log('🔐 === НАЧАЛО ЛОГИНА ===');
            const { phone, code, type = 'sms', deviceId, deviceInfo = {} } = req.body;
            console.log('📱 Данные:', { phone, code, type, deviceId });

            if (!phone || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон и код обязательны',
                    code: 'PHONE_CODE_REQUIRED'
                });
            }

            if (!deviceId) {
                return res.status(400).json({ 
                    success: false,
                    error: 'ID устройства обязателен',
                    code: 'DEVICE_ID_REQUIRED'
                });
            }

            // Проверяем код
            const codeResult = await client.query(
                'SELECT * FROM verification_codes WHERE phone = $1 AND code = $2 AND is_used = false AND expires_at > NOW()',
                [phone, code]
            );

            if (codeResult.rows.length === 0) {
                console.log('❌ Код не найден или истек');
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код подтверждения',
                    code: 'INVALID_CODE'
                });
            }

            const verificationCode = codeResult.rows[0];
            
            // Помечаем код как использованный
            await client.query(
                'UPDATE verification_codes SET is_used = true, used_at = NOW() WHERE id = $1',
                [verificationCode.id]
            );

            // Ищем пользователя
            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            let user;
            
            if (userResult.rows.length === 0) {
                // Автоматическая регистрация
                const userId = 'user_' + Date.now();
                const username = 'user_' + phone.slice(-6);
                const displayName = 'User ' + phone.slice(-4);
                
                const newUserResult = await client.query(
                    `INSERT INTO users (
                        user_id, phone, username, display_name, 
                        role, is_premium, is_banned, warnings, auth_level,
                        status, last_seen
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                    [
                        userId, 
                        phone,
                        username,
                        displayName,
                        'user',
                        false,
                        false,
                        0,
                        'sms_only',
                        'online',
                        Date.now()
                    ]
                );
                
                user = newUserResult.rows[0];
                
                // Создаем security запись
                await UserSecurity.createOrUpdate(user.user_id);
                
                console.log('🆕 Создан новый пользователь:', user.user_id);
            } else {
                user = userResult.rows[0];
                
                // Обновляем статус
                await client.query(
                    'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                    ['online', Date.now(), user.user_id]
                );
            }

            // СОЗДАЕМ ПОЛНУЮ СЕССИЮ ЧЕРЕЗ СЕРВИС
            const sessionResult = await SessionService.createUserSession(
                {
                    userId: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name
                },
                {
                    deviceId,
                    deviceName: deviceInfo.deviceName || 'Android Device',
                    os: deviceInfo.os || 'Android',
                    deviceInfo
                },
                req.ip
            );

            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

            console.log('✅ Логин успешен:', { 
                userId: user.user_id, 
                deviceId,
                sessionId: sessionResult.session.id 
            });

            res.json({
                success: true,
                session: sessionResult.session,
                tokens: sessionResult.tokens,
                user: {
                    id: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name,
                    role: user.role,
                    is_premium: user.is_premium,
                    status: 'online'
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
                error: 'Ошибка входа: ' + error.message,
                code: 'LOGIN_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 🔄 Обновление токенов (ОБНОВЛЕННЫЙ)
    async refreshToken(req, res) {
        try {
            const { refreshToken } = req.body;
            
            if (!refreshToken) {
                return res.status(400).json({
                    success: false,
                    error: 'Refresh token обязателен',
                    code: 'REFRESH_TOKEN_REQUIRED'
                });
            }

            const result = await SessionService.refreshUserTokens(refreshToken, req.ip);
            
            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('❌ Ошибка обновления токена:', error);
            
            const status = error.code === 'INVALID_REFRESH_TOKEN' || 
                          error.code === 'SESSION_NOT_FOUND' ? 401 : 500;
            
            res.status(status).json({
                success: false,
                error: error.message,
                code: error.code || 'REFRESH_ERROR'
            });
        }
    }

    // 📋 Получение активных сессий (ОБНОВЛЕННЫЙ)
    async getSessions(req, res) {
        try {
            const { userId, deviceId } = req.user;
            
            const sessions = await SessionService.getUserSessions(userId, deviceId);
            
            res.json({
                success: true,
                sessions,
                count: sessions.length,
                currentDeviceId: deviceId
            });

        } catch (error) {
            console.error('❌ Ошибка получения сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения сессий',
                code: 'GET_SESSIONS_ERROR'
            });
        }
    }

    // 🚪 Завершение конкретной сессии (ОБНОВЛЕННЫЙ)
    async endSession(req, res) {
        try {
            const { userId, deviceId } = req.user;
            const { sessionId } = req.params;
            
            const terminated = await SessionService.terminateSession(sessionId, userId, deviceId);
            
            res.json({
                success: true,
                message: 'Сессия завершена',
                sessionId: terminated.session_id
            });

        } catch (error) {
            console.error('❌ Ошибка завершения сессии:', error);
            
            const status = error.code === 'SESSION_NOT_FOUND' || 
                          error.code === 'UNAUTHORIZED' ? 404 : 500;
            
            res.status(status).json({
                success: false,
                error: error.message,
                code: error.code || 'END_SESSION_ERROR'
            });
        }
    }

    // 🚫 Завершение всех сессий кроме текущей (ОБНОВЛЕННЫЙ)
    async endAllSessions(req, res) {
        try {
            const { userId, deviceId } = req.user;
            
            const count = await SessionService.terminateAllOtherSessions(userId, deviceId);
            
            res.json({
                success: true,
                message: `Все другие сессии (${count}) завершены`,
                terminatedCount: count
            });

        } catch (error) {
            console.error('❌ Ошибка завершения всех сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка завершения сессий',
                code: 'END_ALL_SESSIONS_ERROR'
            });
        }
    }

    // 🚪 Выход из текущей сессии (ОБНОВЛЕННЫЙ)
    async logout(req, res) {
        try {
            const { userId, deviceId, sessionId } = req.user;
            
            const terminated = await SessionService.logout(userId, deviceId, sessionId);
            
            if (terminated) {
                res.json({
                    success: true,
                    message: 'Вы вышли из системы'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Не удалось выйти из системы',
                    code: 'LOGOUT_FAILED'
                });
            }

        } catch (error) {
            console.error('❌ Ошибка выхода:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка выхода',
                code: 'LOGOUT_ERROR'
            });
        }
    }

    // 🔍 Проверка регистрации пользователя
    async checkUserRegistration(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.body;
            console.log('🔍 Проверка регистрации:', phone);

            if (!phone) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Телефон обязателен',
                    code: 'PHONE_REQUIRED'
                });
            }

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );

            if (userResult.rows.length === 0) {
                console.log('🆕 Пользователь не найден:', phone);
                return res.status(200).json({ 
                    success: true,
                    userExists: false,
                    needsRegistration: true,
                    message: 'Требуется регистрация'
                });
            }

            const user = userResult.rows[0];
            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

            console.log('✅ Пользователь найден:', user.user_id);

            res.json({
                success: true,
                userExists: true,
                needsRegistration: false,
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
                error: 'Ошибка проверки пользователя',
                code: 'CHECK_REGISTRATION_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 📋 Получение требований аутентификации
    async getAuthRequirements(req, res) {
        const client = await db.getClient();
        try {
            const { phone } = req.params;
            console.log('🔍 Требования аутентификации для:', phone);

            const userResult = await client.query(
                'SELECT * FROM users WHERE phone = $1',
                [phone]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Пользователь не найден',
                    code: 'USER_NOT_FOUND'
                });
            }

            const user = userResult.rows[0];
            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

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
                error: error.message,
                code: 'GET_REQUIREMENTS_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 👤 Получение пользователя по ID
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
                    error: 'Пользователь не найден',
                    code: 'USER_NOT_FOUND'
                });
            }

            const user = userResult.rows[0];
            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

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
                error: error.message,
                code: 'GET_USER_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 🧹 Очистка просроченных кодов
    async cleanExpiredCodes(req, res) {
        const client = await db.getClient();
        try {
            const result = await client.query(
                'DELETE FROM verification_codes WHERE expires_at < NOW() RETURNING COUNT(*)'
            );
            
            const deletedCount = parseInt(result.rows[0].count);
            
            res.json({
                success: true,
                message: `Удалено ${deletedCount} просроченных кодов`,
                deletedCount: deletedCount
            });

        } catch (error) {
            console.error('❌ Ошибка очистки кодов:', error);
            res.status(500).json({ 
                success: false,
                error: error.message,
                code: 'CLEAN_CODES_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 🔐 Проверка 2FA кода
    async verify2FACode(req, res) {
        try {
            const { userId, code } = req.body;
            console.log('🔐 Проверка 2FA:', { userId, code });

            if (!userId || !code) {
                return res.status(400).json({ 
                    success: false,
                    error: 'ID пользователя и код обязательны',
                    code: '2FA_DATA_REQUIRED'
                });
            }

            const securitySettings = await UserSecurity.findByUserId(userId);

            if (!securitySettings || !securitySettings.two_fa_enabled) {
                return res.status(400).json({ 
                    success: false,
                    error: '2FA не включена для этого пользователя',
                    code: '2FA_NOT_ENABLED'
                });
            }

            const isValid2FACode = await this.validate2FACode(securitySettings.two_fa_secret, code);

            if (!isValid2FACode) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код 2FA',
                    code: 'INVALID_2FA_CODE'
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
                message: '2FA проверка пройдена',
                code: '2FA_VERIFIED'
            });

        } catch (error) {
            console.error('❌ Ошибка проверки 2FA:', error);
            res.status(500).json({ 
                success: false,
                error: 'Ошибка проверки 2FA: ' + error.message,
                code: '2FA_ERROR'
            });
        }
    }

    // 🔧 Валидация 2FA кода
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

    // 🆕 Регистрация пользователя
    async register(req, res) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN');
            
            const { phone, displayName, username, role = 'user' } = req.body;
            console.log('🆕 Регистрация:', { phone, username });

            // Проверка телефона
            const phoneCheck = await client.query(
                'SELECT phone FROM users WHERE phone = $1 FOR UPDATE',
                [phone]
            );
            
            if (phoneCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует',
                    code: 'PHONE_EXISTS'
                });
            }

            // Проверка username
            const cleanUsername = username ? username.trim().toLowerCase() : null;
            
            if (cleanUsername) {
                const usernameRegex = /^[a-zA-Z0-9_]+$/;
                if (cleanUsername.length < 3 || !usernameRegex.test(cleanUsername)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false,
                        error: 'Username должен быть минимум 3 символа и содержать только буквы, цифры и подчеркивание',
                        code: 'INVALID_USERNAME'
                    });
                }

                const usernameCheck = await client.query(
                    'SELECT username FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE',
                    [cleanUsername]
                );
                
                if (usernameCheck.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false,
                        error: `Username @${cleanUsername} уже занят`,
                        code: 'USERNAME_EXISTS'
                    });
                }
            }

            // Создание пользователя
            const timestamp = Date.now();
            const userId = 'user_' + timestamp;
            const finalUsername = cleanUsername || phone;
            const finalDisplayName = displayName || "User " + phone.slice(-4);

            const result = await client.query(
                `INSERT INTO users (
                    user_id, phone, username, display_name, 
                    role, is_premium, is_banned, warnings, auth_level,
                    status, last_seen
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [
                    userId, 
                    phone,
                    finalUsername,
                    finalDisplayName,
                    role,
                    false,
                    false,
                    0,
                    'sms_only',
                    'offline',
                    Date.now()
                ]
            );

            const newUser = result.rows[0];
            
            // Создание security записи
            await UserSecurity.createOrUpdate(newUser.user_id);
            
            await client.query('COMMIT');
            
            console.log('✅ Пользователь зарегистрирован:', { 
                id: newUser.user_id, 
                username: newUser.username 
            });

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
                },
                code: 'REGISTRATION_SUCCESS'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Ошибка регистрации:', error);
            
            if (error.code === '23505') {
                const constraint = error.constraint || '';
                
                if (constraint.includes('username')) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Этот username уже занят',
                        code: 'USERNAME_EXISTS'
                    });
                }
                
                if (constraint.includes('phone')) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Этот телефон уже зарегистрирован',
                        code: 'PHONE_EXISTS'
                    });
                }
            }
            
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера: ' + error.message,
                code: 'REGISTRATION_ERROR'
            });
        } finally {
            client.release();
        }
    }

    // 🆕 Создание сессии устройства
    async createDeviceSession(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId, deviceInfo = {} } = req.body;
            
            if (!userId || !deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'ID пользователя и устройства обязательны',
                    code: 'USER_DEVICE_REQUIRED'
                });
            }

            const userResult = await client.query(
                'SELECT * FROM users WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Пользователь не найден',
                    code: 'USER_NOT_FOUND'
                });
            }

            const user = userResult.rows[0];
            
            const sessionResult = await SessionService.createUserSession(
                {
                    userId: user.user_id,
                    phone: user.phone,
                    username: user.username,
                    displayName: user.display_name
                },
                {
                    deviceId,
                    deviceName: deviceInfo.deviceName || 'Android Device',
                    os: deviceInfo.os || 'Android',
                    deviceInfo
                },
                req.ip
            );

            res.json({
                success: true,
                session: sessionResult.session,
                tokens: sessionResult.tokens,
                user: {
                    id: user.user_id,
                    username: user.username,
                    displayName: user.display_name
                },
                code: 'SESSION_CREATED'
            });

        } catch (error) {
            console.error('❌ Ошибка создания сессии:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка создания сессии: ' + error.message,
                code: 'SESSION_CREATE_ERROR'
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new AuthController();  