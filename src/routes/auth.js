const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

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

module.exports = router;