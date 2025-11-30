const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

class TwoFAService {
    // Генерация секрета
    static generateSecret() {
        return speakeasy.generateSecret({
            name: "MyMessenger",
            length: 20
        }).base32;
    }

    // Генерация QR кода
    static generateQRCode(secret, email) {
        const otpauthUrl = speakeasy.otpauthURL({
            secret: secret,
            label: encodeURIComponent(`MyMessenger:${email}`),
            issuer: "MyMessenger",
            encoding: 'base32'
        });
        
        return QRCode.toDataURL(otpauthUrl);
    }

    // Проверка кода
    static verifyCode(secret, token) {
        return speakeasy.totp.verify({
            secret: secret,
            token: token,
            encoding: 'base32',
            window: 1
        });
    }

    // Генерация backup кодов
    static generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < 5; i++) {
            codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
        }
        return codes.join(',');
    }
}

module.exports = TwoFAService;