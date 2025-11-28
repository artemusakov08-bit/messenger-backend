const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const User = require('../models/User');
const UserSecurity = require('../models/UserSecurity');
const AuditLog = require('../models/AuditLog');

class SecurityController {
    async getSecuritySettings(req, res) {
        try {
            const security = await UserSecurity.findOne({ userId: req.user.id });
            
            if (!security) {
                return res.json({
                    twoFAEnabled: false,
                    codeWordEnabled: false,
                    additionalPasswords: [],
                    securityLevel: 'low',
                    trustedDevices: []
                });
            }
            
            res.json({
                twoFAEnabled: security.two_fa_enabled,
                codeWordEnabled: security.code_word_enabled,
                codeWordHint: security.code_word_hint,
                additionalPasswords: security.additional_passwords ? JSON.parse(security.additional_passwords) : [],
                securityLevel: security.security_level,
                trustedDevices: security.trusted_devices ? JSON.parse(security.trusted_devices) : [],
                lastSecurityUpdate: security.last_security_update
            });
            
        } catch (error) {
            console.error('Get security settings error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to get security settings' 
            });
        }
    }
    
    async generate2FASecret(req, res) {
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const secret = speakeasy.generateSecret({
                name: `Messenger (${user.phone})`,
                issuer: 'Messenger'
            });
            
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
            
            res.json({
                success: true,
                secret: secret.base32,
                qrCode: qrCodeUrl,
                manualEntryKey: secret.base32
            });
            
        } catch (error) {
            console.error('Generate 2FA secret error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to generate 2FA secret' 
            });
        }
    }
    
    async enable2FA(req, res) {
        try {
            const { secret, code } = req.body;
            
            if (!secret || !code) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Secret and code are required' 
                });
            }
            
            const verified = speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: code,
                window: 2
            });
            
            if (!verified) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid verification code' 
                });
            }
            
            const [security, created] = await UserSecurity.findOrCreate(
                { userId: req.user.id },
                { userId: req.user.id }
            );
            
            await UserSecurity.update(
                { userId: req.user.id },
                {
                    twoFAEnabled: true,
                    twoFASecret: secret,
                    twoFASetupAt: Date.now(),
                    securityLevel: 'high'
                }
            );
            
            res.json({
                success: true,
                message: '2FA has been enabled successfully'
            });
            
        } catch (error) {
            console.error('Enable 2FA error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to enable 2FA' 
            });
        }
    }
    
    async setCodeWord(req, res) {
        try {
            const { codeWord, hint } = req.body;
            
            if (!codeWord || codeWord.length < 4) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Code word must be at least 4 characters' 
                });
            }
            
            const bcrypt = require('bcrypt');
            const codeWordHash = await bcrypt.hash(codeWord, 12);
            
            await UserSecurity.update(
                { userId: req.user.id },
                {
                    codeWordEnabled: true,
                    codeWordHash: codeWordHash,
                    codeWordHint: hint,
                    codeWordSetAt: Date.now(),
                    securityLevel: 'medium'
                }
            );
            
            res.json({
                success: true,
                message: 'Code word has been set successfully'
            });
            
        } catch (error) {
            console.error('Set code word error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to set code word' 
            });
        }
    }
    
    async addAdditionalPassword(req, res) {
        try {
            const { password, name } = req.body;
            
            if (!password || password.length < 6) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Password must be at least 6 characters' 
                });
            }
            
            const security = await UserSecurity.findOne({ userId: req.user.id });
            const additionalPasswords = security?.additional_passwords ? JSON.parse(security.additional_passwords) : [];
            
            const bcrypt = require('bcrypt');
            const hashedPassword = await bcrypt.hash(password, 12);
            
            const newPassword = {
                id: require('crypto').randomBytes(8).toString('hex'),
                name: name || 'Дополнительный пароль',
                hash: hashedPassword,
                createdAt: new Date().toISOString(),
                used: false
            };
            
            additionalPasswords.push(newPassword);
            
            await UserSecurity.update(
                { userId: req.user.id },
                {
                    additionalPasswords: additionalPasswords,
                    securityLevel: 'high'
                }
            );
            
            res.json({
                success: true,
                passwordId: newPassword.id,
                message: 'Additional password has been added'
            });
            
        } catch (error) {
            console.error('Add additional password error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to add additional password' 
            });
        }
    }
    
    async verifySecurity(req, res) {
        try {
            const { twoFACode, codeWord, additionalPassword } = req.body;
            const { operation } = req.params;
            
            const security = await UserSecurity.findOne({ userId: req.user.id });
            
            if (!security || security.security_level === 'low') {
                const operationToken = this.generateOperationToken(req.user.id, operation);
                return res.json({
                    verified: true,
                    operationToken: operationToken
                });
            }
            
            let verified = true;
            const requiredMethods = [];
            
            if (security.two_fa_enabled) {
                if (!twoFACode) {
                    verified = false;
                    requiredMethods.push('2fa');
                } else {
                    const twoFAVerified = speakeasy.totp.verify({
                        secret: security.two_fa_secret,
                        encoding: 'base32',
                        token: twoFACode,
                        window: 2
                    });
                    
                    if (!twoFAVerified) {
                        verified = false;
                    }
                }
            }
            
            if (verified) {
                const operationToken = this.generateOperationToken(req.user.id, operation);
                res.json({
                    verified: true,
                    operationToken: operationToken
                });
            } else {
                res.status(403).json({
                    verified: false,
                    requiredMethods: requiredMethods,
                    error: 'Security verification required'
                });
            }
            
        } catch (error) {
            console.error('Security verification error:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Security verification failed' 
            });
        }
    }
    
    generateOperationToken(userId, operation) {
        const jwt = require('jsonwebtoken');
        return jwt.sign(
            { 
                userId: userId,
                operation: operation,
                type: 'operation'
            },
            process.env.JWT_SECRET + '_operations',
            { expiresIn: '5m' }
        );
    }
}

module.exports = new SecurityController();