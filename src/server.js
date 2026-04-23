require("dotenv").config();
const express = require("express");

// Initialize database
require("./db");

const app = express();
app.use(express.json());

// Routes
app.use("/api", require("./routes/rank"));

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
