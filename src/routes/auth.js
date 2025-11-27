const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ РЕГИСТРАЦИЯ
router.post('/register', authController.register);

// Многоуровневая аутентификация
router.post('/multi-level-login', authController.multiLevelLogin);

// Получение требований аутентификации для роли
router.get('/requirements/:phone', authController.getAuthRequirements);

module.exports = router;