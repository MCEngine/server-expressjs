const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const EconomyPlayer = sequelize.define(
  "economy_players",
  {
    account_type: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false,
    },
    account_uuid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      allowNull: false,
    },
    coin: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    copper: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    silver: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    gold: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "economy_players",
    timestamps: false,
  }
);

module.exports = EconomyPlayer;
