const express = require("express");
const router = express.Router();
const RankPlayer = require("../models/RankPlayer");

// Function to check rank
async function checkRank(type, uuid) {
  if (!uuid) return "member";
  try {
    const player = await RankPlayer.findOne({
      where: { account_type: type, account_uuid: uuid }
    });

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

router.post("/rank", async (req, res) => {
  const { action, account_type, account_uuid, rank, days } = req.body;
  const type = account_type || "player";
  const uuid = account_uuid;

  if (!uuid) return res.status(400).json({ error: "account_uuid is required" });

  try {
    // ACTION: CHECK RANK
    if (action === "rank_check") {
      const currentRank = await checkRank(type, uuid);
      return res.json({ 
        account_type: type,
        account_uuid: uuid,
        rank: currentRank 
      });
    }

    // ACTION: SET/UPDATE RANK
    if (action === "rank_set") {
      if (!rank) return res.status(400).json({ error: "Rank is required" });

      let expiryDate = null;
      if (days) {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(days));
      }

      await RankPlayer.upsert({
        account_type: type,
        account_uuid: uuid,
        rank: rank,
        last_day: expiryDate
      });

      return res.json({ 
        message: "Rank updated",
        account_type: type,
        account_uuid: uuid,
        rank: rank,
        expires: expiryDate
      });
    }

    return res.status(400).json({ error: "Invalid action provided" });
  } catch (error) {
    console.error("Rank API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
