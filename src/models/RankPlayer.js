const { DataTypes } = require("sequelize");
const sequelize = require("../db");

// Define the rank_players table schema
const RankPlayer = sequelize.define(
  "rank_players",
  {
    uuid: {
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
    timestamps: false, // We don't need createdAt/updatedAt for this specific schema
  },
);

module.exports = RankPlayer;
