const express = require("express");
const router = express.Router();
const BackpackStorage = require("../models/backpack/BackpackStorage");
const BackpackLog = require("../models/backpack/BackpackLog");

/**
 * Backpack Storage API
 * Handles saving and retrieving backpack contents
 */

// POST /api/backpack
// Request Body: { action: "get" | "save" | "lock" | "unlock", uuid: string, player_uuid: string, contents?: string }
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
        defaults: { contents: null, is_locked: false }
      });

      if (backpack.is_locked) {
        return res.status(423).json({ 
          error: "Backpack is locked", 
          message: "This backpack is currently being accessed by another process." 
        });
      }

      return res.json({
        uuid: backpack.uuid,
        contents: backpack.contents,
        updated_at: backpack.updated_at,
        is_locked: backpack.is_locked,
        message: created ? "New backpack record created" : "Existing backpack record found"
      });
    }

    // ACTION: LOCK
    if (action === "lock") {
      const [backpack] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents: null, is_locked: true }
      });

      if (backpack.is_locked && !backpack._proudly_created) { // Sequelize internal flag for findOrCreate if created
        // If it was already locked by someone else
        return res.status(423).json({ error: "Backpack already locked" });
      }

      backpack.is_locked = true;
      await backpack.save();

      return res.json({ message: "Backpack locked", uuid: backpack.uuid });
    }

    // ACTION: UNLOCK
    if (action === "unlock") {
      const backpack = await BackpackStorage.findByPk(uuid);
      if (!backpack) {
        return res.status(404).json({ error: "Backpack not found" });
      }

      backpack.is_locked = false;
      await backpack.save();

      return res.json({ message: "Backpack unlocked", uuid: backpack.uuid });
    }

    // ACTION: SAVE
    if (action === "save") {
      if (contents === undefined) {
        return res.status(400).json({ error: "contents is required for save action" });
      }

      // Find or create the backpack record
      const [backpack, created] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents, is_locked: false }
      });

      if (!created) {
        // Update existing record
        backpack.contents = contents;
        backpack.updated_at = new Date();
        // Auto-unlock on save to ensure state consistency
        backpack.is_locked = false;
        await backpack.save();
      }

      return res.json({
        message: created ? "Backpack created" : "Backpack updated and unlocked",
        uuid: backpack.uuid
      });
    }

    return res.status(400).json({ error: "Invalid action. Use 'get', 'save', 'lock', or 'unlock'." });

  } catch (error) {
    console.error("Backpack API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Bulk Backpack Logging
 * POST /api/backpack/logs
 * Request Body: { token: string, logs: Array<{ backpack_uuid, player_uuid, action, created_at? }> }
 */
router.post("/backpack/logs", async (req, res) => {
  const { logs } = req.body;

  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: "logs array is required" });
  }

  try {
    // Sequelize bulkCreate for efficient database insertion
    const createdLogs = await BackpackLog.bulkCreate(logs, {
      validate: true,
      returning: false // Setting to false for performance
    });

    return res.json({
      message: `Successfully logged ${createdLogs.length} entries`,
      count: createdLogs.length
    });
  } catch (error) {
    console.error("Backpack Bulk Log Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
