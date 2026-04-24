require("dotenv").config();
const express = require("express");
require("./db");

const app = express();
app.use(express.json());

// Safely handle BigInt serialization for JSON without global prototype pollution
app.set('json replacer', (key, value) =>
  typeof value === 'bigint' ? value.toString() : value
);

// Global Token Verification Middleware (Header-based)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }
  
  next();
};

app.use("/api", verifyToken);

// Routes
app.use("/api", require("./routes/membership"));
app.use("/api", require("./routes/economy"));
app.use("/api", require("./routes/backpack"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
