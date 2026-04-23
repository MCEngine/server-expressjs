const { DataTypes } = require("sequelize");
const sequelize = require("../../db");

/**
 * Backpack Logs Model
 * Tracks which players access which backpacks
 */
const BackpackLog = sequelize.define(
  "backpack_logs",
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    backpack_uuid: {
      type: DataTypes.STRING(36),
      allowNull: false,
    },
    player_uuid: {
      type: DataTypes.STRING(36),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(20),
      allowNull: false, // e.g., 'get', 'save'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "backpack_logs",
    timestamps: false,
    // Note: "no delete on cascade" is handled by not defining explicit 
    // Sequelize associations with CASCADE constraints here.
  }
);

module.exports = BackpackLog;
