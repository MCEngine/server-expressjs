const express = require("express");
const router = express.Router();
const BackpackStorage = require("../models/BackpackStorage");
const BackpackLog = require("../models/BackpackLog");

/**
 * Backpack Storage API
 * Handles saving and retrieving backpack contents
 */

// POST /api/backpack
// Request Body: { action: "get" | "save", uuid: string, player_uuid: string, contents?: string }
router.post("/backpack", async (req, res) => {
  const { action, uuid, player_uuid, contents } = req.body;

  if (!uuid) {
    return res.status(400).json({ error: "uuid is required" });
  }

  if (!player_uuid) {
    return res.status(400).json({ error: "player_uuid is required for tracking" });
  }

  try {
    // Log the attempt
    await BackpackLog.create({
      backpack_uuid: uuid,
      player_uuid: player_uuid,
      action: action
    });

    // ACTION: GET
    if (action === "get") {
      // Find or create the backpack record if it doesn't exist
      const [backpack, created] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents: null }
      });

      return res.json({
        uuid: backpack.uuid,
        contents: backpack.contents,
        updated_at: backpack.updated_at,
        message: created ? "New backpack record created" : "Existing backpack record found"
      });
    }

    // ACTION: SAVE
    if (action === "save") {
      if (contents === undefined) {
        return res.status(400).json({ error: "contents is required for save action" });
      }

      // Find or create the backpack record
      const [backpack, created] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents }
      });

      if (!created) {
        // Update existing record
        backpack.contents = contents;
        backpack.updated_at = new Date();
        await backpack.save();
      }

      return res.json({
        message: created ? "Backpack created" : "Backpack updated",
        uuid: backpack.uuid
      });
    }

    return res.status(400).json({ error: "Invalid action. Use 'get' or 'save'." });

  } catch (error) {
    console.error("Backpack API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
