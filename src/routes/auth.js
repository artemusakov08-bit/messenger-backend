const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const deviceAuthMiddleware = require('../middleware/deviceAuthMiddleware');

// 🔍 Проверка регистрации пользователя
router.post('/check-registration', (req, res) => {
    authController.checkUserRegistration(req, res);
});

// 📱 Отправка кода подтверждения
router.post('/send-code', (req, res) => {
    authController.sendVerificationCode(req, res);
});

// 🔐 Проверка кода и вход
router.post('/verify-login', (req, res) => {
    authController.verifyCodeAndLogin(req, res);
});

// 🔐 Проверка 2FA кода
router.post('/verify-2fa', (req, res) => {
    authController.verify2FACode(req, res);
});

// 🧹 Очистка просроченных кодов
router.post('/clean-codes', (req, res) => {
    authController.cleanExpiredCodes(req, res);
});

// 📋 Получение требований аутентификации
router.get('/requirements/:phone', (req, res) => {
    authController.getAuthRequirements(req, res);
});

// 👤 Получение пользователя по ID
router.get('/user/:userId', (req, res) => {
    authController.getUserById(req, res);
});

// 🆕 Регистрация пользователя
router.post('/register', (req, res) => {
    authController.register(req, res);
});

// 🆕 Создание сессии устройства (после успешного входа)
router.post('/create-session', (req, res) => {
    authController.createDeviceSession(req, res);
});

// 🔄 Обновление токенов
router.post('/refresh-token', (req, res) => {
    authController.refreshToken(req, res);
});

// 📋 Получение активных сессий (требует авторизацию)
router.get('/sessions', deviceAuthMiddleware.authenticate, (req, res) => {
    authController.getSessions(req, res);
});

// 🚪 Выход из текущей сессии
router.post('/logout', deviceAuthMiddleware.authenticate, (req, res) => { 
    authController.logout(req, res);
});

// 🚫 Завершение конкретной сессии
router.delete('/sessions/:sessionId', deviceAuthMiddleware.authenticate, (req, res) => {  
    authController.endSession(req, res);
});

// 🚫 Завершение всех других сессий
router.delete('/sessions', deviceAuthMiddleware.authenticate, (req, res) => {  
    authController.endAllSessions(req, res);
});

// QR код для входа
router.post('/qr/generate', (req, res) => {
    authController.generateQR(req, res);
});

// Проверка статуса QR
router.get('/qr/status/:qrId', (req, res) => {
    authController.checkQRStatus(req, res);
});

// Подтверждение QR с мобильного приложения
router.post('/qr/confirm', deviceAuthMiddleware.authenticate, (req, res) => {
    authController.confirmQR(req, res);
});

module.exports = router;