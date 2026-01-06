const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const sessionMiddleware = require('../middleware/sessionMiddleware');

// 🔐 Публичные маршруты
router.post('/send-sms-code', sessionController.sendSMSCode);
router.post('/check-registration', sessionController.checkRegistration);
router.post('/login', sessionController.login);
router.post('/refresh', sessionController.refresh);

// 🔐 Защищенные маршруты
router.get('/check', sessionMiddleware.authenticate, sessionController.checkSession);
router.get('/current', sessionMiddleware.authenticate, sessionController.getCurrentSession);
router.get('/all', sessionMiddleware.authenticate, sessionController.getSessions);
router.delete('/logout', sessionMiddleware.authenticate, sessionController.logout);
router.delete('/terminate/:sessionId', sessionMiddleware.authenticate, sessionController.terminateSession);
router.delete('/terminate-others', sessionMiddleware.authenticate, sessionController.terminateAllOtherSessions);

module.exports = router;