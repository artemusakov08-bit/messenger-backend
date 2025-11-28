const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const securityController = require('../controllers/securityController');

router.use(authMiddleware.authenticate);

router.get('/settings', securityController.getSecuritySettings);
router.post('/2fa/generate', securityController.generate2FASecret);
router.post('/2fa/enable', securityController.enable2FA);
router.post('/codeword/set', securityController.setCodeWord);
router.post('/passwords/add', securityController.addAdditionalPassword);
router.post('/verify/:operation', securityController.verifySecurity);

router.get('/dashboard', async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Панель управления безопасностью',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Ошибка получения панели безопасности:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных безопасности'
        });
    }
});

module.exports = router;