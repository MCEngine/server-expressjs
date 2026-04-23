require("dotenv").config();
const express = require("express");
require("./db");

const app = express();
app.use(express.json());

// Global Token Verification Middleware
const verifyToken = (req, res, next) => {
  const token = req.body.token;
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }
  next();
};

// Apply middleware to all /api routes
app.use("/api", verifyToken);

// Routes
app.use("/api", require("./routes/rank"));
app.use("/api", require("./routes/economy"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
