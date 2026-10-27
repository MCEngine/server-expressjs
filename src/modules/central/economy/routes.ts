import { Router, type Request } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { integerSchema, uuidSchema } from '../http.js';
import type { CentralEconomyRepository, MarketItem } from './repository.js';

/**
 * A Java `long` the plugin sends as a string. The value must survive the trip
 * through a JavaScript number, so anything past 2^53 is refused rather than
 * rounded -- a balance that silently changes is worse than one that fails.
 */
const money = integerSchema.refine(Number.isSafeInteger, 'Out of range.');
const accountType = z.string().trim().min(1).max(32);
const name = z.string().min(1).max(255);
const code = z.string().min(1).max(64);
const limit = z.number().int().min(1).max(1000).default(50);

const economyAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_account'), account_type: accountType, account_uuid: uuidSchema }),
  z.object({ action: z.literal('get_account'), account_type: accountType, account_uuid: uuidSchema }),
  z.object({
    action: z.literal('create_currency'),
    system_code: code,
    display_name: name,
    is_transferable: z.boolean().default(true),
  }),
  z.object({ action: z.literal('get_currencies') }),
  z.object({
    action: z.literal('get_wallet'),
    account_type: accountType,
    account_uuid: uuidSchema,
    currency_id: z.number().int(),
  }),
  z.object({
    action: z.literal('set_wallet'),
    account_type: accountType,
    account_uuid: uuidSchema,
    currency_id: z.number().int(),
    amount: money,
  }),
  z.object({
    action: z.literal('insert_log'),
    account_type: accountType,
    account_uuid: uuidSchema,
    scope: z.string().min(1).max(32),
    currency_id: z.number().int(),
    amount: money,
    transaction_uuid: uuidSchema.nullish(),
    reference_type: z.string().max(64).nullish(),
    reference_id: z.string().max(255).nullish(),
  }),
]);

const marketAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_item'),
    market_name: name,
    item_index: z.number().int(),
    metadata: z.string().nullish(),
    buy_price: money,
    sell_price: money,
    currency: code,
    amount: z.number().int(),
  }),
  z.object({ action: z.literal('get_item'), market_name: name, item_index: z.number().int() }),
  z.object({ action: z.literal('get_items'), market_name: name }),
  z.object({ action: z.literal('list_markets') }),
  z.object({ action: z.literal('delete_item'), market_name: name, item_index: z.number().int() }),
]);

const slayerAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('log_kill'),
    player_uuid: uuidSchema,
    mob_type: code,
    world: z.string().max(255).nullish(),
    x: z.number().default(0),
    y: z.number().default(0),
    z: z.number().default(0),
  }),
  z.object({
    action: z.literal('log_reward'),
    player_uuid: uuidSchema,
    mob_type: code,
    currency: code,
    amount: money,
  }),
  z.object({ action: z.literal('get_kills'), player_uuid: uuidSchema, limit }),
  z.object({ action: z.literal('get_rewards'), player_uuid: uuidSchema, limit }),
]);

/** Money goes back out as a string, the way the plugins read it. */
const withMoney = <T extends object>(row: T, ...keys: (keyof T & string)[]) => ({
  ...row,
  ...Object.fromEntries(keys.map((k) => [k, String(row[k])])),
});

/**
 * Reads the `action` the body names, so an action the server does not know is
 * a 400 that says which one -- not a schema dump of every union branch.
 */
function parseAction<T extends z.ZodTypeAny>(schema: T, known: readonly string[], req: Request): z.infer<T> {
  const action = (req.body as { action?: unknown } | undefined)?.action;
  if (typeof action !== 'string' || !known.includes(action)) {
    throw errors.badRequest('unknown_action', `Unknown action: ${String(action)}.`, { known });
  }
  return schema.parse(req.body);
}

const actionsOf = (schema: { optionsMap: Map<unknown, unknown> }) => [...schema.optionsMap.keys()].map(String);

/**
 * MCEconomy (`POST /api/economy`), Market (`POST /api/economy/market`) and
 * SlayerRewards (`POST /api/economy/slayerrewards`): one endpoint each, the
 * operation named by an `action` field, exactly as their released clients
 * send it.
 *
 * Mounted at `/api/economy`.
 */
export function createCentralEconomyRouter(repo: CentralEconomyRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());
  const economyActions = actionsOf(economyAction);
  const marketActions = actionsOf(marketAction);
  const slayerActions = actionsOf(slayerAction);

  const requireCurrency = async (id: number) => {
    if (!(await repo.currencyExists(id))) throw errors.notFound('currency_not_found', `No currency ${id}.`);
  };

  router.post('/', async (req, res) => {
    const body = parseAction(economyAction, economyActions, req);
    switch (body.action) {
      case 'create_account':
        res.json({ account: await repo.ensureAccount(body.account_type, body.account_uuid, now()) });
        return;
      case 'get_account':
        res.json({ account: (await repo.account(body.account_type, body.account_uuid)) ?? null });
        return;
      case 'create_currency':
        res.json({ currency: await repo.saveCurrency(body.system_code, body.display_name, body.is_transferable, now()) });
        return;
      case 'get_currencies':
        res.json({ currencies: await repo.currencies() });
        return;
      case 'get_wallet':
        await requireCurrency(body.currency_id);
        res.json({
          wallet: withMoney(await repo.wallet(body.account_type, body.account_uuid, body.currency_id, now()), 'amount'),
        });
        return;
      case 'set_wallet':
        await requireCurrency(body.currency_id);
        res.json({
          wallet: withMoney(
            await repo.setWallet(body.account_type, body.account_uuid, body.currency_id, body.amount, now()),
            'amount',
          ),
        });
        return;
      case 'insert_log':
        await repo.log(
          {
            accountType: body.account_type,
            accountUuid: body.account_uuid,
            scope: body.scope,
            currencyId: body.currency_id,
            amount: body.amount,
            transactionUuid: body.transaction_uuid ?? null,
            referenceType: body.reference_type ?? null,
            referenceId: body.reference_id ?? null,
          },
          now(),
        );
        res.json({ success: true });
        return;
    }
  });

  router.post('/market', async (req, res) => {
    const body = parseAction(marketAction, marketActions, req);
    const item = (row: MarketItem) => withMoney(row, 'buy_price', 'sell_price');
    switch (body.action) {
      case 'save_item':
        await repo.saveItem({
          market_name: body.market_name,
          item_index: body.item_index,
          metadata: body.metadata ?? null,
          buy_price: body.buy_price,
          sell_price: body.sell_price,
          currency: body.currency,
          amount: body.amount,
        });
        res.json({ success: true });
        return;
      case 'get_item': {
        const found = await repo.item(body.market_name, body.item_index);
        res.json({ item: found === undefined ? null : item(found) });
        return;
      }
      case 'get_items':
        res.json({ items: (await repo.items(body.market_name)).map(item) });
        return;
      case 'list_markets':
        res.json({ markets: await repo.markets() });
        return;
      case 'delete_item':
        res.json({ success: await repo.deleteItem(body.market_name, body.item_index) });
        return;
    }
  });

  router.post('/slayerrewards', async (req, res) => {
    const body = parseAction(slayerAction, slayerActions, req);
    switch (body.action) {
      case 'log_kill':
        await repo.logKill({
          player_uuid: body.player_uuid,
          mob_type: body.mob_type,
          world: body.world ?? null,
          x: body.x,
          y: body.y,
          z: body.z,
          created_at: now(),
        });
        res.json({ success: true });
        return;
      case 'log_reward':
        await repo.logReward({
          player_uuid: body.player_uuid,
          mob_type: body.mob_type,
          currency: body.currency,
          amount: body.amount,
          created_at: now(),
        });
        res.json({ success: true });
        return;
      case 'get_kills':
        res.json({ kills: await repo.kills(body.player_uuid, body.limit) });
        return;
      case 'get_rewards':
        res.json({ rewards: (await repo.rewards(body.player_uuid, body.limit)).map((r) => withMoney(r, 'amount')) });
        return;
    }
  });

  return router;
}
