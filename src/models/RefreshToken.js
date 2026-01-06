const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id'
  },
  deviceId: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'device_id'
  },
  token: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'expires_at'
  },
  isRevoked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_revoked'
  },
  revokedAt: {
    type: DataTypes.DATE,
    field: 'revoked_at'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    field: 'ip_address'
  },
  userAgent: {
    type: DataTypes.TEXT,
    field: 'user_agent'
  }
}, {
  tableName: 'refresh_tokens',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['device_id'] },
    { fields: ['token'] },
    { fields: ['expires_at'] },
    { fields: ['is_revoked'] }
  ]
});

// Методы
RefreshToken.prototype.isExpired = function() {
  return new Date() > this.expiresAt;
};

RefreshToken.prototype.isValid = function() {
  return !this.isRevoked && !this.isExpired();
};

RefreshToken.prototype.revoke = async function() {
  this.isRevoked = true;
  this.revokedAt = new Date();
  await this.save();
};

// Статические методы
RefreshToken.findValidToken = async function(token) {
  return await this.findOne({
    where: {
      token,
      isRevoked: false,
      expiresAt: {
        [Op.gt]: new Date()
      }
    }
  });
};

RefreshToken.getUserTokens = async function(userId) {
  return await this.findAll({
    where: {
      userId,
      isRevoked: false
    },
    order: [['createdAt', 'DESC']]
  });
};

RefreshToken.revokeUserTokens = async function(userId, exceptDeviceId = null) {
  const where = {
    userId,
    isRevoked: false
  };
  
  if (exceptDeviceId) {
    where.deviceId = { [Op.ne]: exceptDeviceId };
  }
  
  return await this.update(
    {
      isRevoked: true,
      revokedAt: new Date()
    },
    { where }
  );
};

RefreshToken.cleanExpiredTokens = async function() {
  return await this.destroy({
    where: {
      expiresAt: {
        [Op.lt]: new Date()
      }
    }
  });
};

module.exports = RefreshToken;