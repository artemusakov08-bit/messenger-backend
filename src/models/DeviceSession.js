const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DeviceSession = sequelize.define('DeviceSession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  deviceId: {
    type: DataTypes.STRING(255), 
    allowNull: false
  },
  deviceInfo: {
    type: DataTypes.JSONB,
    defaultValue: {
      os: '',
      model: '',
      brand: '',
      appVersion: '',
      pushToken: ''
    }
  },
  accessToken: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  accessTokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  refreshTokenExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  lastActiveAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  ipAddress: {
    type: DataTypes.STRING(45)
  },
  location: {
    type: DataTypes.JSONB
  }
}, {
  tableName: 'device_sessions',
  indexes: [
    { fields: ['userId'] },
    { fields: ['deviceId'] },
    { fields: ['refreshToken'] },
    { fields: ['accessTokenExpiresAt'] }
  ]
});