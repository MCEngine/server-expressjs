const express = require("express");
const router = express.Router();
const EconomyAccount = require("../models/economy/EconomyAccount");

async function getAccount(type, uuid) {
  const [account] = await EconomyAccount.findOrCreate({
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
    const validCoins = ["coin", "copper", "silver", "gold"];

    if (action === "get_coin") {
      return res.json({
        account_type: type,
        account_uuid: uuid,
        balances: { coin: account.coin, copper: account.copper, silver: account.silver, gold: account.gold }
      });
    }

    if (action === "add_coin") {
      if (!coin_type || amount === undefined) return res.status(400).json({ error: "coin_type and amount required" });
      if (!validCoins.includes(coin_type)) return res.status(400).json({ error: "Invalid coin_type" });
      
      await account.increment(coin_type, { by: amount });
      await account.reload();
      return res.json({ message: "Coin added", balance: account[coin_type].toString() });
    }

    if (action === "minus_coin") {
      if (!coin_type || amount === undefined) return res.status(400).json({ error: "coin_type and amount required" });
      if (!validCoins.includes(coin_type)) return res.status(400).json({ error: "Invalid coin_type" });
      
      const currentBalance = BigInt(account[coin_type]);
      if (currentBalance < BigInt(amount)) return res.status(400).json({ error: "Insufficient funds" });

      await account.decrement(coin_type, { by: amount });
      await account.reload();
      return res.json({ message: "Coin deducted", balance: account[coin_type].toString() });
    }

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

