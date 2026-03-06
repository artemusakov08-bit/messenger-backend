const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Создаем папку для аватарок если её нет
const uploadDir = 'uploads/avatars';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ Папка для аватарок создана:', uploadDir);
}

// Настройка хранилища
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Генерируем уникальное имя: avatar-{userId}-{uuid}.jpg
        const userId = req.user?.userId || 'unknown';
        const uniqueId = uuidv4().split('-')[0];
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `avatar-${userId}-${uniqueId}${ext}`;
        cb(null, filename);
    }
});

// Фильтр для проверки типа файла
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('❌ Неверный формат. Разрешены: JPG, PNG, GIF, WEBP'), false);
    }
};

// Настройка multer с ограничениями
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 
    }
});

module.exports = upload;