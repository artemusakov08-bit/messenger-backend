class AutoModerationService {
    static bannedWords = ['спам', 'мошенничество', 'взлом', 'обман'];
    static warningThreshold = 3;

    static async scanMessage(content) {
        const violations = [];
        
        // Проверка запрещенных слов
        const foundBannedWords = this.bannedWords.filter(word => 
            content.toLowerCase().includes(word)
        );
        
        if (foundBannedWords.length > 0) {
            violations.push({
                type: 'banned_words',
                words: foundBannedWords,
                severity: 'high'
            });
        }

        // Проверка спама
        if (this.isSpam(content)) {
            violations.push({
                type: 'spam',
                severity: 'medium'
            });
        }

        return violations;
    }

    static isSpam(content) {
        // Простая проверка на спам (повторяющиеся символы/слова)
        const repeatedChars = /(.)\1{5,}/;
        const repeatedWords = /\b(\w+)\b.*\b\1\b.*\b\1\b/;
        
        return repeatedChars.test(content) || repeatedWords.test(content);
    }

    static async autoAction(userId, violations) {
        const highSeverity = violations.filter(v => v.severity === 'high');
        
        if (highSeverity.length > 0) {
            return {
                action: 'auto_delete',
                notifyModerator: true,
                message: 'Сообщение удалено автоматически'
            };
        }

        return {
            action: 'flag_for_review',
            notifyModerator: false
        };
    }
}

module.exports = AutoModerationService;