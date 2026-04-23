const express = require("express");
const router = express.Router();
const EconomyPlayer = require("../models/EconomyPlayer");

// Token verification middleware (Applied via server.js for all /api routes)

// Helper: Get or Create Account
async function getAccount(type, uuid) {
  const [account] = await EconomyPlayer.findOrCreate({
    where: { account_type: type, account_uuid: uuid },
    defaults: { coin: 0, copper: 0, silver: 0, gold: 0 }
  });
  return account;
}

router.post("/economy", async (req, res) => {
  const { action, account_type, account_uuid, coin_type, amount } = req.body;
  const type = account_type || "player";
  const uuid = account_uuid;

  if (!uuid) return res.status(400).json({ error: "account_uuid is required" });

  try {
    const account = await getAccount(type, uuid);

    // ACTION: GET COIN
    if (action === "get_coin") {
      return res.json({
        account_type: type,
        account_uuid: uuid,
        balances: {
          coin: account.coin,
          copper: account.copper,
          silver: account.silver,
          gold: account.gold
        }
      });
    }

    // ACTION: ADD COIN
    if (action === "add_coin") {
      if (!coin_type || amount === undefined) return res.status(400).json({ error: "coin_type and amount required" });
      
      account[coin_type] = BigInt(account[coin_type]) + BigInt(amount);
      account.updated_at = new Date();
      await account.save();
      
      return res.json({ message: "Coin added", balance: account[coin_type].toString() });
    }

    // ACTION: MINUS COIN (Check not below 0)
    if (action === "minus_coin") {
      if (!coin_type || amount === undefined) return res.status(400).json({ error: "coin_type and amount required" });
      
      const currentBalance = BigInt(account[coin_type]);
      const amountToMinus = BigInt(amount);

      if (currentBalance < amountToMinus) {
        return res.status(400).json({ error: "Insufficient funds", current: currentBalance.toString() });
      }

      account[coin_type] = currentBalance - amountToMinus;
      account.updated_at = new Date();
      await account.save();

      return res.json({ message: "Coin deducted", balance: account[coin_type].toString() });
    }

    // ACTION: CREATE ACCOUNT
    if (action === "create_account") {
      return res.json({ message: "Account verified/created", account_uuid: uuid });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("Economy API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
