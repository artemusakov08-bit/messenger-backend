const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const securityController = require('../controllers/securityController');

// Применяем аутентификацию ко всем маршрутам
router.use(authMiddleware.authenticate);

// 🔐 Получить настройки безопасности
router.get('/settings', (req, res) => {
  securityController.getSecuritySettings(req, res);
});

// 🔄 2FA Routes
router.post('/2fa/generate', (req, res) => {
  securityController.generate2FASecret(req, res);
});

router.post('/2fa/enable', (req, res) => {
  securityController.enable2FA(req, res);
});

// 🗣️ Code Word Routes
router.post('/codeword/set', (req, res) => {
  securityController.setCodeWord(req, res);
});

// 🔑 Additional Passwords Routes
router.post('/passwords/add', (req, res) => {
  securityController.addAdditionalPassword(req, res);
});

// 🛡️ Security Verification for sensitive operations
router.post('/verify/:operation', (req, res) => {
  securityController.verifySecurity(req, res);
});

module.exports = router;