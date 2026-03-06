const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const authMiddleware = require('../middleware/authMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

// Загрузка аватара (требуется авторизация)
router.post(
    '/avatar',
    authMiddleware.authenticate,
    uploadMiddleware.single('avatar'),
    uploadController.uploadAvatar
);

// Удаление аватара
router.delete(
    '/avatar/:filename',
    authMiddleware.authenticate,
    uploadController.deleteAvatar
);

// Публичный доступ к аватарам (без авторизации)
router.get('/avatars/:filename', uploadController.getAvatar);

module.exports = router;