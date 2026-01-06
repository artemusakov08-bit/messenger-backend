const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    field: 'session_id'
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
  deviceName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'Unknown Device',
    field: 'device_name'
  },
  os: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Unknown'
  },
  deviceInfo: {
    type: DataTypes.JSONB,
    defaultValue: {},
    field: 'device_info'
  },
  sessionToken: {
    type: DataTypes.STRING(500),
    allowNull: false,
    field: 'session_token'
  },
  accessToken: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'access_token'
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'refresh_token'
  },
  accessTokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'access_token_expires_at'
  },
  refreshTokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'refresh_token_expires_at'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    field: 'ip_address'
  },
  location: {
    type: DataTypes.JSONB,
    defaultValue: null
  },
  lastActiveAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'last_active_at'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'sessions',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['device_id'] },
    { fields: ['session_token'] },
    { fields: ['refresh_token'] },
    { fields: ['access_token_expires_at'] },
    { fields: ['is_active'] }
  ]
});

// 🔧 Методы для сессий
Session.prototype.isAccessTokenExpired = function() {
  return new Date() > this.accessTokenExpiresAt;
};

Session.prototype.isRefreshTokenExpired = function() {
  return new Date() > this.refreshTokenExpiresAt;
};

Session.prototype.isValid = function() {
  return this.isActive && !this.isRefreshTokenExpired();
};

Session.prototype.deactivate = async function() {
  this.isActive = false;
  await this.save();
};

Session.prototype.updateActivity = async function(ipAddress = null) {
  this.lastActiveAt = new Date();
  if (ipAddress) this.ipAddress = ipAddress;
  await this.save();
};

// 🔍 Статические методы
Session.findBySessionToken = async function(sessionToken) {
  return await this.findOne({
    where: {
      sessionToken,
      isActive: true
    }
  });
};

Session.findByRefreshToken = async function(refreshToken) {
  return await this.findOne({
    where: {
      refreshToken,
      isActive: true
    }
  });
};

Session.findByAccessToken = async function(accessToken) {
  return await this.findOne({
    where: {
      accessToken,
      isActive: true
    }
  });
};

Session.getUserSessions = async function(userId) {
  return await this.findAll({
    where: {
      userId,
      isActive: true
    },
    order: [['lastActiveAt', 'DESC']]
  });
};

Session.cleanExpiredSessions = async function() {
  return await this.destroy({
    where: {
      refreshTokenExpiresAt: {
        [Op.lt]: new Date()
      }
    }
  });
};

// 🔄 Обновить токены
Session.prototype.refreshTokens = async function(newTokens, ipAddress = null) {
  this.accessToken = newTokens.accessToken;
  this.refreshToken = newTokens.refreshToken;
  this.accessTokenExpiresAt = new Date(Date.now() + 3600 * 1000); // 1 час
  this.refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 дней
  this.lastActiveAt = new Date();
  if (ipAddress) this.ipAddress = ipAddress;
  
  await this.save();
  return this;
};

module.exports = Session;