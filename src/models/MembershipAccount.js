const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const MembershipAccount = sequelize.define(
  "membership_accounts",
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
    tier: {
      type: DataTypes.ENUM("standard", "copper", "silver", "gold"),
      defaultValue: "standard",
      allowNull: false,
    },
    last_day: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "membership_accounts",
    timestamps: false,
  }
);

module.exports = MembershipAccount;
