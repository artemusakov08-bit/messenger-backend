const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

class FileUtils {
    // Оптимизация изображения (сжатие и изменение размера)
    static async optimizeImage(filePath, userId) {
        try {
            const outputPath = path.join('uploads/avatars', `optimized-${userId}-${Date.now()}.jpg`);
            
            await sharp(filePath)
                .resize(200, 200, { fit: 'cover' }) // Уменьшаем до 200x200
                .jpeg({ quality: 80 }) // Качество 80%
                .toFile(outputPath);
            
            // Удаляем оригинальный файл
            await fs.unlink(filePath).catch(() => {});
            
            return outputPath;
        } catch (error) {
            console.error('❌ Ошибка оптимизации:', error);
            return filePath; // Возвращаем оригинал если ошибка
        }
    }

    // Удаление файла
    static async deleteFile(filePath) {
        try {
            if (!filePath) return false;
            
            // Извлекаем имя файла из URL
            const filename = path.basename(filePath);
            const fullPath = path.join('uploads/avatars', filename);
            
            await fs.unlink(fullPath);
            console.log('✅ Файл удален:', filename);
            return true;
        } catch (error) {
            console.error('❌ Ошибка удаления файла:', error);
            return false;
        }
    }

    // Получение полного URL аватара
    static getAvatarUrl(filename, req) {
        if (!filename) return null;
        const protocol = req?.protocol || 'https';
        const host = req?.get('host') || 'localhost:10000';
        return `${protocol}://${host}/uploads/avatars/${filename}`;
    }
}

module.exports = FileUtils;