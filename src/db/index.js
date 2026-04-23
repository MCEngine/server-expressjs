const { Sequelize } = require("sequelize");
const path = require("path");

// ==========================================
// Database Setup
// ==========================================
const dialect = process.env.DB_DIALECT || "sqlite";
let sequelize;

if (dialect === "mysql") {
  // MySQL connection
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: "mysql",
      logging: false,
    },
  );
} else {
  // SQLite connection
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: process.env.DB_STORAGE || path.join(__dirname, "../../database.sqlite"),
    logging: false,
  });
}

// Initialize database tables when server starts
sequelize
  .sync()
  .then(() => {
    console.log("Database synced. All tables initialized.");
  })
  .catch((err) => {
    console.error("Failed to sync database:", err);
  });

module.exports = sequelize;
