const express = require("express");
const router = express.Router();
const MembershipAccount = require("../models/MembershipAccount");

async function checkMembership(type, uuid) {
  if (!uuid) return "standard";
  try {
    const player = await MembershipAccount.findOne({
      where: { account_type: type, account_uuid: uuid },
    });

    if (!player) return "standard";

    if (player.last_day && new Date() > player.last_day) {
      player.tier = "standard";
      player.last_day = null;
      await player.save();
      return "standard";
    }
    return player.tier;
  } catch (error) {
    console.error("Database query error:", error);
    return "standard";
  }
}

router.post("/membership", async (req, res) => {
  const { action, account_type, account_uuid, tier, days } = req.body;
  const type = account_type || "player";
  const uuid = account_uuid;

  if (!uuid) return res.status(400).json({ error: "account_uuid is required" });

  try {
    if (action === "membership_check") {
      const currentTier = await checkMembership(type, uuid);
      return res.json({
        account_type: type,
        account_uuid: uuid,
        tier: currentTier,
      });
    }

    if (action === "membership_set") {
      if (!tier) return res.status(400).json({ error: "Tier is required" });

      let expiryDate = null;
      if (days) {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(days));
      }

      await MembershipAccount.upsert({
        account_type: type,
        account_uuid: uuid,
        tier: tier,
        last_day: expiryDate,
      });

      return res.json({
        message: "Membership updated",
        account_type: type,
        account_uuid: uuid,
        tier: tier,
        expires: expiryDate,
      });
    }

    return res.status(400).json({ error: "Invalid action provided" });
  } catch (error) {
    console.error("Membership API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
