const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { UserSecurity, VerificationCode, Session } = require('../models');
const jwtUtils = require('../utils/jwtUtils');

console.log('🔑 === ПРОВЕРКА JWT_SECRET ===');
console.log('🔑 JWT_SECRET в process.env:', process.env.JWT_SECRET ? 'ЕСТЬ' : 'НЕТ');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('❌ ОШИБКА: JWT_SECRET не найден в переменных окружения Render');
    throw new Error('JWT_SECRET не настроен в Render Environment Variables');
}

console.log('✅ JWT_SECRET загружен');
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
            const codeId = 'code_' + Date.now();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут
            
            const client = await db.getClient();
            try {
                await client.query(
                    `INSERT INTO verification_codes (id, phone, code, type, expires_at, created_at)
                     VALUES ($1, $2, $3, $4, $5, NOW())`,
                    [codeId, phone, code, type, expiresAt]
                );
                
                console.log('✅ Код создан:', { phone, code });
                
                res.json({
                    success: true,
                    message: 'Код подтверждения отправлен',
                    code: code, // Для тестирования
                    expiresIn: 10
                });
            } finally {
                client.release();
            }

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
            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

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

    // 🆕 СОЗДАНИЕ СЕССИИ УСТРОЙСТВА (исправленная)
    async createDeviceSession(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId, deviceInfo = {} } = req.body;
            
            if (!userId || !deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'ID пользователя и устройства обязательны'
                });
            }

            // Проверяем существование пользователя
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

            // Генерируем пару токенов
            const tokenPair = jwtUtils.generateTokenPair(userId, deviceId);
            
            // Вычисляем даты истечения
            const now = new Date();
            const accessTokenExpiresAt = new Date(now.getTime() + 3600 * 1000);
            const refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

            // Проверяем существующую сессию
            const existingSession = await client.query(
                'SELECT * FROM sessions WHERE user_id = $1 AND device_id = $2 AND is_active = true',
                [userId, deviceId]
            );

            let session;
            
            if (existingSession.rows.length > 0) {
                // Обновляем существующую сессию
                const result = await client.query(
                    `UPDATE sessions SET 
                        device_name = $1, device_info = $2, access_token = $3, refresh_token = $4,
                        access_token_expires_at = $5, refresh_token_expires_at = $6,
                        ip_address = $7, last_active_at = $8
                     WHERE session_id = $9 RETURNING *`,
                    [
                        deviceInfo.deviceName || 'Android Device',
                        JSON.stringify(deviceInfo),
                        tokenPair.accessToken,
                        tokenPair.refreshToken,
                        accessTokenExpiresAt,
                        refreshTokenExpiresAt,
                        req.ip,
                        now,
                        existingSession.rows[0].session_id
                    ]
                );
                session = result.rows[0];
                console.log('✅ Сессия обновлена для устройства:', deviceId);
            } else {
                // Создаем новую сессию
                const sessionId = 'sess_' + Date.now();
                const result = await client.query(
                    `INSERT INTO sessions (
                        session_id, user_id, device_id, device_name, device_info,
                        access_token, refresh_token, access_token_expires_at, refresh_token_expires_at,
                        ip_address, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                    [
                        sessionId, userId, deviceId,
                        deviceInfo.deviceName || 'Android Device',
                        JSON.stringify(deviceInfo),
                        tokenPair.accessToken,
                        tokenPair.refreshToken,
                        accessTokenExpiresAt,
                        refreshTokenExpiresAt,
                        req.ip,
                        now
                    ]
                );
                session = result.rows[0];
                console.log('✅ Создана сессия для устройства:', deviceId);
            }

            res.json({
                success: true,
                session: {
                    id: session.session_id,
                    deviceId: session.device_id,
                    deviceName: session.device_name,
                    createdAt: session.created_at
                },
                tokens: {
                    accessToken: tokenPair.accessToken,
                    refreshToken: tokenPair.refreshToken,
                    accessTokenExpiresAt: session.access_token_expires_at,
                    refreshTokenExpiresAt: session.refresh_token_expires_at
                },
                user: {
                    id: userResult.rows[0].user_id,
                    username: userResult.rows[0].username,
                    displayName: userResult.rows[0].display_name
                }
            });

        } catch (error) {
            console.error('❌ Ошибка создания сессии:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка создания сессии: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🔄 ОБНОВЛЕНИЕ ACCESS TOKEN (исправленная)
    async refreshToken(req, res) {
        const client = await db.getClient();
        try {
            const { refreshToken } = req.body;
            
            if (!refreshToken) {
                return res.status(400).json({
                    success: false,
                    error: 'Refresh token обязателен'
                });
            }

            // Валидация refresh токена
            const tokenResult = jwtUtils.verifyRefreshToken(refreshToken);
            
            if (!tokenResult.valid) {
                return res.status(401).json({
                    success: false,
                    error: 'Неверный refresh token'
                });
            }

            const { userId, deviceId } = tokenResult.decoded;
            
            // Ищем активную сессию
            const sessionResult = await client.query(
                'SELECT * FROM sessions WHERE refresh_token = $1 AND is_active = true',
                [refreshToken]
            );
            
            if (sessionResult.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    error: 'Сессия не найдена или неактивна'
                });
            }

            const session = sessionResult.rows[0];
            
            // Генерируем новую пару токенов
            const tokenPair = jwtUtils.generateTokenPair(userId, deviceId);
            
            // Обновляем токены в сессии
            const now = new Date();
            const result = await client.query(
                `UPDATE sessions SET 
                    access_token = $1,
                    refresh_token = $2,
                    access_token_expires_at = $3,
                    refresh_token_expires_at = $4,
                    last_active_at = $5
                 WHERE session_id = $6 RETURNING *`,
                [
                    tokenPair.accessToken,
                    tokenPair.refreshToken,
                    new Date(now.getTime() + 3600 * 1000),
                    new Date(now.getTime() + 30 * 24 * 3600 * 1000),
                    now,
                    session.session_id
                ]
            );

            const updatedSession = result.rows[0];
            console.log(`✅ Токены обновлены для устройства:`, deviceId);

            res.json({
                success: true,
                accessToken: tokenPair.accessToken,
                refreshToken: tokenPair.refreshToken,
                accessTokenExpiresAt: updatedSession.access_token_expires_at
            });

        } catch (error) {
            console.error('❌ Ошибка обновления токена:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка обновления токена: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 📋 ПОЛУЧЕНИЕ АКТИВНЫХ СЕССИЙ ПОЛЬЗОВАТЕЛЯ (исправленная)
    async getSessions(req, res) {
        const client = await db.getClient();
        try {
            const { userId } = req.user;
            
            const result = await client.query(
                `SELECT * FROM sessions 
                 WHERE user_id = $1 AND is_active = true 
                 ORDER BY last_active_at DESC`,
                [userId]
            );
            
            const formattedSessions = result.rows.map(session => ({
                id: session.session_id,
                deviceId: session.device_id,
                deviceName: session.device_name,
                deviceInfo: session.device_info ? JSON.parse(session.device_info) : {},
                ipAddress: session.ip_address,
                location: session.location ? JSON.parse(session.location) : null,
                createdAt: session.created_at,
                lastActiveAt: session.last_active_at,
                isCurrent: session.device_id === req.user.deviceId,
                isActive: session.is_active
            }));

            res.json({
                success: true,
                sessions: formattedSessions,
                count: formattedSessions.length
            });

        } catch (error) {
            console.error('❌ Ошибка получения сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка получения сессий: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🚪 ЗАВЕРШЕНИЕ КОНКРЕТНОЙ СЕССИИ (исправленная)
    async endSession(req, res) {
        const client = await db.getClient();
        try {
            const { userId } = req.user;
            const { sessionId } = req.params;
            
            const result = await client.query(
                'UPDATE sessions SET is_active = false WHERE session_id = $1 AND user_id = $2 RETURNING *',
                [sessionId, userId]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Сессия не найдена'
                });
            }

            const session = result.rows[0];
            
            // Нельзя завершить текущую сессию через этот метод
            if (session.device_id === req.user.deviceId) {
                return res.status(400).json({
                    success: false,
                    error: 'Для завершения текущей сессии используйте logout'
                });
            }

            res.json({
                success: true,
                message: 'Сессия завершена',
                sessionId: session.session_id
            });

        } catch (error) {
            console.error('❌ Ошибка завершения сессии:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка завершения сессии: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🚫 ЗАВЕРШЕНИЕ ВСЕХ СЕССИЙ (кроме текущей) (исправленная)
    async endAllSessions(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId } = req.user;
            
            const result = await client.query(
                'UPDATE sessions SET is_active = false WHERE user_id = $1 AND device_id != $2 AND is_active = true RETURNING COUNT(*)',
                [userId, deviceId]
            );
            
            const count = parseInt(result.rows[0].count);
            
            res.json({
                success: true,
                message: `Все другие сессии (${count}) завершены`
            });

        } catch (error) {
            console.error('❌ Ошибка завершения всех сессий:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка завершения сессий: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    // 🚪 ВЫХОД (завершение текущей сессии) (исправленная)
    async logout(req, res) {
        const client = await db.getClient();
        try {
            const { userId, deviceId } = req.user;
            
            const result = await client.query(
                'UPDATE sessions SET is_active = false WHERE user_id = $1 AND device_id = $2 AND is_active = true RETURNING *',
                [userId, deviceId]
            );
            
            if (result.rows.length > 0) {
                await client.query(
                    'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                    ['offline', Date.now(), userId]
                );
            }
            
            res.json({
                success: true,
                message: 'Вы вышли из системы'
            });

        } catch (error) {
            console.error('❌ Ошибка выхода:', error);
            res.status(500).json({
                success: false,
                error: 'Ошибка выхода: ' + error.message
            });
        } finally {
            client.release();
        }
    }

    async register(req, res) {
        const client = await db.getClient();
        
        try {
            await client.query('BEGIN'); // Начало транзакции
            
            const { phone, displayName, username, role = 'user' } = req.body;
            console.log('🆕 Регистрация (с транзакцией):', { phone, username });

            // 1. Проверка телефона
            const phoneCheck = await client.query(
                'SELECT phone FROM users WHERE phone = $1 FOR UPDATE',
                [phone]
            );
            
            if (phoneCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    error: 'Пользователь с таким телефоном уже существует' 
                });
            }

            // 2. Проверка username (если указан)
            const cleanUsername = username ? username.trim().toLowerCase() : null;
            
            if (cleanUsername) {
                // Проверка формата
                const usernameRegex = /^[a-zA-Z0-9_]+$/;
                if (cleanUsername.length < 3 || !usernameRegex.test(cleanUsername)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false,
                        error: 'Username должен быть минимум 3 символа и содержать только буквы, цифры и подчеркивание' 
                    });
                }

                // Проверка в БД с блокировкой
                const usernameCheck = await client.query(
                    'SELECT username FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE',
                    [cleanUsername]
                );
                
                if (usernameCheck.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false,
                        error: `Username @${cleanUsername} уже занят` 
                    });
                }
            }

            // 3. Создание пользователя
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
            
            // 4. Создание security записи
            await UserSecurity.createOrUpdate(newUser.user_id);
            
            await client.query('COMMIT'); // Фиксация транзакции
            
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
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Ошибка регистрации:', error);
            
            // Обработка ошибки UNIQUE constraint
            if (error.code === '23505') {
                const constraint = error.constraint || '';
                
                if (constraint.includes('username')) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Этот username уже занят' 
                    });
                }
                
                if (constraint.includes('phone')) {
                    return res.status(400).json({ 
                        success: false,
                        error: 'Этот телефон уже зарегистрирован' 
                    });
                }
            }
            
            res.status(500).json({ 
                success: false,
                error: 'Ошибка сервера: ' + error.message 
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

            // Проверяем код
            const codeResult = await client.query(
                'SELECT * FROM verification_codes WHERE phone = $1 AND code = $2 AND is_used = false AND expires_at > NOW()',
                [phone, code]
            );

            if (codeResult.rows.length === 0) {
                console.log('❌ Код не найден или истек');
                return res.status(400).json({ 
                    success: false,
                    error: 'Неверный код подтверждения' 
                });
            }

            // Помечаем код как использованный
            await client.query(
                'UPDATE verification_codes SET is_used = true WHERE id = $1',
                [codeResult.rows[0].id]
            );

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
            const securityResult = await client.query(
                'SELECT * FROM user_security WHERE user_id = $1',
                [user.user_id]
            );
            const securitySettings = securityResult.rows[0];

            await client.query(
                'UPDATE users SET status = $1, last_seen = $2 WHERE user_id = $3',
                ['online', Date.now(), user.user_id]
            );

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
                    error: 'Пользователь не найден' 
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
                error: error.message 
            });
        } finally {
            client.release();
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
                error: error.message 
            });
        } finally {
            client.release();
        }
    }

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
                error: error.message 
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new AuthController();