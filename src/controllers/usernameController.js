const pool = require('../config/database');

class UsernameController {
    // 🔍 Проверка доступности username
    async checkUsername(req, res) {
        try {
            const { username } = req.params;
            console.log('🔍 Checking username:', username);

            if (!username || username.trim().length < 3) {
                return res.status(200).json({
                    success: true,
                    available: false,
                    message: 'Username должен быть минимум 3 символа',
                    validFormat: false,
                    suggestions: []
                });
            }

            const cleanUsername = username.trim().toLowerCase();
            
            // Валидация формата (только буквы, цифры, подчеркивание)
            const usernameRegex = /^[a-zA-Z0-9_]+$/;
            if (!usernameRegex.test(cleanUsername)) {
                return res.status(200).json({
                    success: true,
                    available: false,
                    message: 'Можно использовать только буквы, цифры и подчеркивание',
                    validFormat: false,
                    suggestions: []
                });
            }

            // Проверка в базе данных
            const result = await pool.query(
                'SELECT username FROM users WHERE LOWER(username) = LOWER($1)',
                [cleanUsername]
            );

            const isAvailable = result.rows.length === 0;
            const isFormatValid = cleanUsername.length >= 3 && usernameRegex.test(cleanUsername);

            let suggestions = [];
            if (!isAvailable) {
                // Генерация вариантов
                suggestions = this.generateSuggestions(cleanUsername);
            }

            res.json({
                success: true,
                available: isAvailable,
                username: cleanUsername,
                message: isAvailable ? 'Username доступен' : 'Username уже занят',
                validFormat: isFormatValid,
                suggestions: suggestions
            });

        } catch (error) {
            console.error('❌ Error checking username:', error);
            res.status(500).json({
                success: false,
                available: false,
                message: 'Ошибка сервера при проверке username',
                validFormat: false,
                suggestions: []
            });
        }
    }

    // Генерация вариантов если занят
    generateSuggestions(username) {
        const suggestions = [];
        const suffixes = ['_', '1', '2', '2024', 'official', 'real', 'pro'];
        
        for (let i = 0; i < 3; i++) {
            const suffix = suffixes[Math.min(i, suffixes.length - 1)];
            suggestions.push(`${username}${suffix}`);
        }
        
        return suggestions;
    }
}

module.exports = new UsernameController();