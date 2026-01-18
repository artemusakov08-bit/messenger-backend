const { body, param, query, validationResult } = require('express-validator');

class ValidationMiddleware {
  // 📱 Валидация телефона
  validatePhone() {
    return [
      body('phone')
        .trim()
        .notEmpty().withMessage('Телефон обязателен')
        .matches(/^\+?[1-9]\d{7,14}$/).withMessage('Неверный формат телефона')
        .isLength({ min: 10, max: 15 }).withMessage('Телефон должен быть от 10 до 15 цифр'),
      
      this.handleValidationErrors
    ];
  }

  // 🔐 Валидация кода подтверждения
  validateVerificationCode() {
    return [
      body('phone')
        .trim()
        .notEmpty().withMessage('Телефон обязателен'),
      
      body('code')
        .trim()
        .notEmpty().withMessage('Код подтверждения обязателен')
        .isNumeric().withMessage('Код должен содержать только цифры')
        .isLength({ min: 4, max: 8 }).withMessage('Код должен быть от 4 до 8 цифр'),
      
      body('type')
        .optional()
        .isIn(['sms', 'call', 'email']).withMessage('Неверный тип подтверждения'),
      
      this.handleValidationErrors
    ];
  }

  // 📱 Валидация данных устройства
  validateDeviceData() {
    return [
      body('deviceId')
        .trim()
        .notEmpty().withMessage('ID устройства обязателен')
        .isLength({ min: 10, max: 100 }).withMessage('ID устройства должен быть от 10 до 100 символов'),
      
      body('deviceInfo')
        .optional()
        .isObject().withMessage('Информация об устройстве должна быть объектом'),
      
      body('deviceInfo.deviceName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 }).withMessage('Название устройства должно быть от 1 до 100 символов'),
      
      body('deviceInfo.os')
        .optional()
        .isIn(['Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Unknown']).withMessage('Неверная операционная система'),
      
      body('deviceInfo.appVersion')
        .optional()
        .matches(/^\d+\.\d+\.\d+$/).withMessage('Неверный формат версии приложения'),
      
      this.handleValidationErrors
    ];
  }

  // 🔄 Валидация refresh token
  validateRefreshToken() {
    return [
      body('refreshToken')
        .trim()
        .notEmpty().withMessage('Refresh token обязателен')
        .isLength({ min: 50 }).withMessage('Неверный формат refresh token'),
      
      this.handleValidationErrors
    ];
  }

  // 👤 Валидация регистрации
  validateRegistration() {
    return [
      body('phone')
        .trim()
        .notEmpty().withMessage('Телефон обязателен')
        .matches(/^\+?[1-9]\d{7,14}$/).withMessage('Неверный формат телефона'),
      
      body('username')
        .optional()
        .trim()
        .isLength({ min: 3, max: 30 }).withMessage('Username должен быть от 3 до 30 символов')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username может содержать только буквы, цифры и подчеркивание'),
      
      body('displayName')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage('Имя должно быть от 2 до 50 символов'),
      
      body('role')
        .optional()
        .isIn(['user', 'moderator', 'admin', 'super_admin']).withMessage('Неверная роль'),
      
      this.handleValidationErrors
    ];
  }

  // 🔐 Валидация 2FA кода
  validate2FACode() {
    return [
      body('userId')
        .trim()
        .notEmpty().withMessage('ID пользователя обязательно'),
      
      body('code')
        .trim()
        .notEmpty().withMessage('Код 2FA обязателен')
        .isNumeric().withMessage('Код должен содержать только цифры')
        .isLength({ min: 6, max: 6 }).withMessage('Код 2FA должен быть 6 цифр'),
      
      this.handleValidationErrors
    ];
  }

  // 🆔 Валидация ID сессии
  validateSessionId() {
    return [
      param('sessionId')
        .trim()
        .notEmpty().withMessage('ID сессии обязателен')
        .matches(/^sess_/).withMessage('Неверный формат ID сессии'),
      
      this.handleValidationErrors
    ];
  }

  // 🆔 Валидация ID пользователя
  validateUserId() {
    return [
      param('userId')
        .trim()
        .notEmpty().withMessage('ID пользователя обязательно')
        .matches(/^user_/).withMessage('Неверный формат ID пользователя'),
      
      this.handleValidationErrors
    ];
  }

  // 📱 Валидация запроса сессий
  validateSessionsQuery() {
    return [
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('Лимит должен быть от 1 до 100'),
      
      query('offset')
        .optional()
        .isInt({ min: 0 }).withMessage('Смещение не может быть отрицательным'),
      
      query('activeOnly')
        .optional()
        .isBoolean().withMessage('activeOnly должен быть true или false'),
      
      this.handleValidationErrors
    ];
  }

  // 🛡️ Обработчик ошибок валидации
  handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => ({
        field: err.param,
        message: err.msg,
        value: err.value
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Ошибка валидации',
        code: 'VALIDATION_ERROR',
        details: errorMessages
      });
    }
    
    next();
  }

  // 🔧 Санитизация данных
  sanitizeInput() {
    return (req, res, next) => {
      // Санитизируем строковые поля
      const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;
        return str.trim().replace(/[<>]/g, '');
      };
      
      // Рекурсивно санитизируем объекты
      const sanitizeObject = (obj) => {
        if (typeof obj !== 'object' || obj === null) return obj;
        
        if (Array.isArray(obj)) {
          return obj.map(item => sanitizeObject(item));
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
          } else if (typeof value === 'object') {
            sanitized[key] = sanitizeObject(value);
          } else {
            sanitized[key] = value;
          }
        }
        return sanitized;
      };
      
      // Санитизируем body, query и params
      if (req.body) req.body = sanitizeObject(req.body);
      if (req.query) req.query = sanitizeObject(req.query);
      if (req.params) req.params = sanitizeObject(req.params);
      
      next();
    };
  }

  // 📏 Проверка длины файлов/данных
  validateDataSize(maxSizeMB = 10) {
    return (req, res, next) => {
      const contentLength = parseInt(req.headers['content-length']) || 0;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      
      if (contentLength > maxSizeBytes) {
        return res.status(413).json({
          success: false,
          error: `Размер данных превышает ${maxSizeMB}MB`,
          code: 'PAYLOAD_TOO_LARGE',
          maxSizeMB: maxSizeMB
        });
      }
      
      next();
    };
  }

  // 🗣️ Валидация кодового слова
  validateCodeWord() {
    return [
      body('codeWord')
        .trim()
        .notEmpty().withMessage('Кодовое слово обязательно')
        .isLength({ min: 4, max: 50 }).withMessage('Кодовое слово должно быть от 4 до 50 символов'),
      
      body('hint')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('Подсказка не может быть длиннее 100 символов'),
      
      this.handleValidationErrors
    ];
  }

  // 🕒 Проверка временных меток
  validateTimestamps() {
    return [
      body('timestamp')
        .optional()
        .isISO8601().withMessage('Неверный формат временной метки')
        .custom((value) => {
          const date = new Date(value);
          const now = new Date();
          const diff = Math.abs(now - date);
          
          // Не позволяем временные метки из будущего или слишком старые (> 24 часа)
          if (date > now) {
            throw new Error('Временная метка не может быть из будущего');
          }
          
          if (diff > 24 * 60 * 60 * 1000) {
            throw new Error('Временная метка слишком старая');
          }
          
          return true;
        }),
      
      this.handleValidationErrors
    ];
  }
}

module.exports = new ValidationMiddleware();