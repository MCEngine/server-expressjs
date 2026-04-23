const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const RankPlayer = sequelize.define(
  "rank_players",
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
    rank: {
      type: DataTypes.ENUM("member", "copper", "silver", "gold"),
      defaultValue: "member",
      allowNull: false,
    },
    last_day: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "rank_players",
    timestamps: false,
  }
);

module.exports = RankPlayer;
