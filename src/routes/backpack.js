const express = require("express");
const router = express.Router();
const BackpackStorage = require("../models/backpack/BackpackStorage");
const BackpackLog = require("../models/backpack/BackpackLog");

router.post("/backpack", async (req, res) => {
  const { action, uuid, player_uuid, contents } = req.body;

  if (!uuid) return res.status(400).json({ error: "uuid is required" });
  if (!player_uuid) return res.status(400).json({ error: "player_uuid is required for tracking" });

  try {
    await BackpackLog.create({
      backpack_uuid: uuid,
      player_uuid: player_uuid,
      action: action
    });

    if (action === "get") {
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

    if (action === "lock") {
      const [backpack, created] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents: null, is_locked: true }
      });

      if (!created && backpack.is_locked) {
        return res.status(423).json({ error: "Backpack already locked" });
      }

      if (!created) {
        backpack.is_locked = true;
        await backpack.save();
      }

      return res.json({ message: "Backpack locked", uuid: backpack.uuid });
    }

    if (action === "unlock") {
      const backpack = await BackpackStorage.findByPk(uuid);
      if (!backpack) return res.status(404).json({ error: "Backpack not found" });

      backpack.is_locked = false;
      await backpack.save();

      return res.json({ message: "Backpack unlocked", uuid: backpack.uuid });
    }

    if (action === "save") {
      if (contents === undefined) return res.status(400).json({ error: "contents is required" });

      const [backpack, created] = await BackpackStorage.findOrCreate({
        where: { uuid },
        defaults: { contents, is_locked: false }
      });

      if (!created) {
        backpack.contents = contents;
        backpack.updated_at = new Date();
        backpack.is_locked = false;
        await backpack.save();
      }

      return res.json({
        message: created ? "Backpack created" : "Backpack updated and unlocked",
        uuid: backpack.uuid
      });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("Backpack API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/backpack/logs", async (req, res) => {
  const { logs } = req.body;
  if (!logs || !Array.isArray(logs)) return res.status(400).json({ error: "logs array is required" });
  try {
    const createdLogs = await BackpackLog.bulkCreate(logs, { validate: true, returning: false });
    return res.json({ message: `Successfully logged ${createdLogs.length} entries`, count: createdLogs.length });
  } catch (error) {
    console.error("Backpack Bulk Log Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;

