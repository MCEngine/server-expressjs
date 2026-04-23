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
    if (!player) return "member";

    if (player.last_day && new Date() > player.last_day) {
      player.rank = "member";
      player.last_day = null;
      await player.save();
      return "member";
    }
    return player.rank;
  } catch (error) {
    console.error("Database query error:", error);
    return "member";
  }
}

// Main API Endpoint
router.post("/rank", verifyToken, async (req, res) => {
  const { action, uuid, rank, days } = req.body;

  try {
    // ACTION: CHECK RANK
    if (action === "rank_check") {
      const currentRank = await checkRank(uuid);
      return res.json({ rank: currentRank });
    }

    // ACTION: SET/UPDATE RANK (Added this part)
    if (action === "rank_set") {
      if (!uuid || !rank) {
        return res.status(400).json({ error: "UUID and Rank are required" });
      }

      // Calculate expiry date if 'days' is provided
      let expiryDate = null;
      if (days) {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(days));
      }

      // Upsert: Update if exists, Create if not
      const [player, created] = await RankPlayer.upsert({
        uuid: uuid,
        rank: rank,
        last_day: expiryDate
      });

      return res.json({ 
        message: created ? "Record created" : "Record updated",
        uuid: uuid,
        rank: rank,
        expires: expiryDate
      });
    }

    return res.status(400).json({ error: "Invalid action provided" });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
