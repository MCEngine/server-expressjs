import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const ACCOUNT = { account_type: 'player', account_uuid: '11111111-2222-3333-4444-555555555555' };
const PLAYER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('central economy routes', () => {
  let s: CentralStack;
  const economy = (body: Record<string, unknown>) => s.post('/api/economy', body);
  const market = (body: Record<string, unknown>) => s.post('/api/economy/market', body);
  const slayer = (body: Record<string, unknown>) => s.post('/api/economy/slayerrewards', body);

  beforeEach(async () => {
    s = await buildCentral();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('needs the shared secret', async () => {
    expect((await request(s.app).post('/api/economy').send({ action: 'get_currencies' })).status).toBe(401);
  });

  it('names an action it does not know', async () => {
    const res = await economy({ action: 'print_money' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unknown_action');
  });

  describe('MCEconomy', () => {
    it('creates an account once, and reads it back with ISO timestamps', async () => {
      const first = await economy({ action: 'create_account', ...ACCOUNT });
      expect(first.status).toBe(200);
      expect(first.body.account).toMatchObject(ACCOUNT);
      expect(first.body.account.created_at).toBe('2026-01-01T00:00:00.000Z');

      await economy({ action: 'create_account', ...ACCOUNT }).expect(200);
      expect((await economy({ action: 'get_account', ...ACCOUNT })).body.account).toMatchObject(ACCOUNT);
      expect(
        (await economy({ action: 'get_account', account_type: 'player', account_uuid: PLAYER })).body.account,
      ).toBeNull();
    });

    it('numbers currencies, and updates one registered again', async () => {
      const coin = await economy({ action: 'create_currency', system_code: 'coin', display_name: 'Coin', is_transferable: true });
      expect(coin.body.currency).toMatchObject({ id: 1, system_code: 'coin', is_transferable: true });

      await economy({ action: 'create_currency', system_code: 'gem', display_name: 'Gem', is_transferable: false });
      const again = await economy({ action: 'create_currency', system_code: 'coin', display_name: 'Gold', is_transferable: false });
      expect(again.body.currency).toMatchObject({ id: 1, display_name: 'Gold', is_transferable: false });

      const all = await economy({ action: 'get_currencies' });
      expect(all.body.currencies.map((c: { system_code: string }) => c.system_code)).toEqual(['coin', 'gem']);
    });

    it('opens a wallet at zero, sets it, and sends money back as a string', async () => {
      await economy({ action: 'create_currency', system_code: 'coin', display_name: 'Coin' });
      const opened = await economy({ action: 'get_wallet', ...ACCOUNT, currency_id: 1 });
      expect(opened.body.wallet).toMatchObject({ ...ACCOUNT, currency_id: 1, amount: '0' });

      const set = await economy({ action: 'set_wallet', ...ACCOUNT, currency_id: 1, amount: '9007199254740991' });
      expect(set.body.wallet.amount).toBe('9007199254740991');
      expect((await economy({ action: 'get_wallet', ...ACCOUNT, currency_id: 1 })).body.wallet.amount).toBe(
        '9007199254740991',
      );
    });

    it('refuses a balance a JavaScript number would round, and a currency that does not exist', async () => {
      await economy({ action: 'create_currency', system_code: 'coin', display_name: 'Coin' });
      expect((await economy({ action: 'set_wallet', ...ACCOUNT, currency_id: 1, amount: '9007199254740993' })).status).toBe(400);
      expect((await economy({ action: 'get_wallet', ...ACCOUNT, currency_id: 9 })).status).toBe(404);
    });

    it('records a ledger entry', async () => {
      const res = await economy({
        action: 'insert_log',
        ...ACCOUNT,
        scope: 'DEPOSIT',
        currency_id: 1,
        amount: '25',
        transaction_uuid: null,
        reference_type: 'market',
        reference_id: 'shop:3',
      });
      expect(res.body).toEqual({ success: true });
      const rows = await s.db.db.selectFrom('mceconomy_logs').selectAll().execute();
      expect(rows[0]).toMatchObject({ scope: 'DEPOSIT', amount: 25, reference_id: 'shop:3' });
    });
  });

  describe('Market', () => {
    const item = (index: number, marketName = 'tools') => ({
      action: 'save_item',
      market_name: marketName,
      item_index: index,
      metadata: 'base64',
      buy_price: '100',
      sell_price: '-1',
      currency: 'coin',
      amount: 1,
    });

    it('saves, replaces, lists and deletes items', async () => {
      await market(item(2)).expect(200);
      await market(item(1)).expect(200);
      await market({ ...item(1), buy_price: '150' }).expect(200);
      await market(item(0, 'food')).expect(200);

      const items = (await market({ action: 'get_items', market_name: 'tools' })).body.items;
      expect(items.map((i: { item_index: number }) => i.item_index)).toEqual([1, 2]);
      expect(items[0]).toMatchObject({ buy_price: '150', sell_price: '-1', currency: 'coin' });

      expect((await market({ action: 'list_markets' })).body.markets).toEqual(['food', 'tools']);
      expect((await market({ action: 'get_item', market_name: 'tools', item_index: 9 })).body.item).toBeNull();

      expect((await market({ action: 'delete_item', market_name: 'tools', item_index: 1 })).body).toEqual({ success: true });
      expect((await market({ action: 'delete_item', market_name: 'tools', item_index: 1 })).body).toEqual({ success: false });
    });
  });

  describe('SlayerRewards', () => {
    it('logs kills and rewards, newest first, up to the limit', async () => {
      for (const mob of ['ZOMBIE', 'SKELETON', 'CREEPER']) {
        await slayer({ action: 'log_kill', player_uuid: PLAYER, mob_type: mob, world: 'world', x: 1.5, y: 64, z: -3 }).expect(200);
      }
      await slayer({ action: 'log_reward', player_uuid: PLAYER, mob_type: 'ZOMBIE', currency: 'coin', amount: '7' }).expect(200);

      const kills = (await slayer({ action: 'get_kills', player_uuid: PLAYER, limit: 2 })).body.kills;
      expect(kills.map((k: { mob_type: string }) => k.mob_type)).toEqual(['CREEPER', 'SKELETON']);
      expect(kills[0]).toMatchObject({ world: 'world', x: 1.5, y: 64, z: -3 });

      const rewards = (await slayer({ action: 'get_rewards', player_uuid: PLAYER, limit: 10 })).body.rewards;
      expect(rewards).toEqual([
        { player_uuid: PLAYER, mob_type: 'ZOMBIE', currency: 'coin', amount: '7', created_at: '2026-01-01T00:00:00.000Z' },
      ]);
    });
  });

  it('leaves /api/v1 alone: the guard on /api/economy never sees it', async () => {
    expect((await request(s.app).get('/api/v1/meta')).status).toBe(200);
  });
});
