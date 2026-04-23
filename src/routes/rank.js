const express = require("express");
const router = express.Router();
const RankPlayer = require("../models/RankPlayer");

// Token verification middleware
function verifyToken(req, res, next) {
  const token = req.body.token;
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }
  next();
}

// Function to check rank
async function checkRank(uuid) {
  if (!uuid) return "member";

  try {
    const player = await RankPlayer.findByPk(uuid);

    // If player not found, return default
    if (!player) return "member";

    // Check if rank has expired
    if (player.last_day && new Date() > player.last_day) {
      // Update to member and remove expiry
      player.rank = "member";
      player.last_day = null;
      await player.save();
      return "member";
    }

    return player.rank;
  } catch (error) {
    console.error("Database query error:", error);
    return "member"; // Fallback safely
  }
}

// Main API Endpoint
router.post("/rank", verifyToken, async (req, res) => {
  const { action, uuid } = req.body;

  // Handle different actions
  try {
    if (action === "rank_check") {
      const rank = await checkRank(uuid);
      return res.json({ rank: rank });
    }

    // Add more actions here in the future
    // else if (action === 'rank_set') { ... }

    return res.status(400).json({ error: "Invalid action provided" });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
