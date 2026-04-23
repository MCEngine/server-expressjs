require("dotenv").config();
const express = require("express");
require("./db");

// Handle BigInt serialization for JSON
BigInt.prototype.toJSON = function () {
  return this.toString();
};

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

app.use("/api", verifyToken);

// Routes
app.use("/api", require("./routes/membership"));
app.use("/api", require("./routes/economy"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
