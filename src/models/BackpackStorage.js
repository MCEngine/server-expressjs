const { DataTypes } = require("sequelize");
const sequelize = require("../db");

/**
 * Backpack Storage Model
 * Stores player backpack contents as base64 strings
 */
const BackpackStorage = sequelize.define(
  "backpack_storage",
  {
    uuid: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      allowNull: false,
      comment: "backpack uuid",
    },
    contents: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "save items as base64 for item within it",
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    is_locked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "locking state to prevent item duplication",
    },
  },
  {
    tableName: "backpack_storage",
    timestamps: false, // Using custom updated_at
  }
);

module.exports = BackpackStorage;
