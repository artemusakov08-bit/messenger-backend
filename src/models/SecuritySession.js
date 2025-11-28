const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SecuritySession = sequelize.define('SecuritySession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  token: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('operation', 'recovery', 'verification'),
    defaultValue: 'operation'
  },
  operation: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  deviceInfo: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  isUsed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'security_sessions',
  indexes: [
    {
      fields: ['token']
    },
    {
      fields: ['userId', 'type']
    },
    {
      fields: ['expiresAt']
    }
  ]
});

// 🔧 Методы для сессий
SecuritySession.prototype.isExpired = function() {
  return new Date() > this.expiresAt;
};

SecuritySession.prototype.isValid = function() {
  return !this.isUsed && !this.isExpired();
};

SecuritySession.prototype.markAsUsed = async function() {
  this.isUsed = true;
  await this.save();
};

// 🔍 Статические методы
SecuritySession.findValidToken = async function(token, type = 'operation') {
  return await this.findOne({
    where: {
      token,
      type,
      isUsed: false,
      expiresAt: {
        [Op.gt]: new Date()
      }
    }
  });
};

SecuritySession.cleanExpiredSessions = async function() {
  return await this.destroy({
    where: {
      expiresAt: {
        [Op.lt]: new Date()
      }
    }
  });
};

module.exports = SecuritySession;