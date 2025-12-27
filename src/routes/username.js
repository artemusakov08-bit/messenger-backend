const express = require('express');
const router = express.Router();
const usernameController = require('../controllers/usernameController');

// 🔍 Проверка username
router.get('/check/:username', (req, res) => {
    usernameController.checkUsername(req, res);
});

module.exports = router;