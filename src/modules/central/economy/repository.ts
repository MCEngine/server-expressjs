import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../db/schema.js';

export interface EconomyAccount {
  account_type: string;
  account_uuid: string;
  created_at: string;
  updated_at: string;
}

export interface EconomyCurrency {
  id: number;
  system_code: string;
  display_name: string;
  is_transferable: boolean;
  created_at: string;
  updated_at: string;
}

export interface EconomyWallet {
  account_type: string;
  account_uuid: string;
  currency_id: number;
  amount: number;
  created_at: string;
  updated_at: string;
}

export interface MarketItem {
  market_name: string;
  item_index: number;
  metadata: string | null;
  buy_price: number;
  sell_price: number;
  currency: string;
  amount: number;
}

export interface SlayerKill {
  player_uuid: string;
  mob_type: string;
  world: string | null;
  x: number;
  y: number;
  z: number;
  created_at: string;
}

export interface SlayerReward {
  player_uuid: string;
  mob_type: string;
  currency: string;
  amount: number;
  created_at: string;
}

export interface LogEntry {
  accountType: string;
  accountUuid: string;
  scope: string;
  currencyId: number;
  amount: number;
  transactionUuid: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

/**
 * Every query behind MCEconomy, Market and SlayerRewards. The shapes are the
 * rows the plugins' own backends return, so the routes can hand them over as
 * they are.
 */
export interface CentralEconomyRepository {
  /** Creates the account if it is new; either way, returns it. */
  ensureAccount(accountType: string, accountUuid: string, at: string): Promise<EconomyAccount>;
  account(accountType: string, accountUuid: string): Promise<EconomyAccount | undefined>;
  /** Registers a currency, or updates the name and flag of one that exists. */
  saveCurrency(systemCode: string, displayName: string, transferable: boolean, at: string): Promise<EconomyCurrency>;
  currencies(): Promise<EconomyCurrency[]>;
  currencyExists(id: number): Promise<boolean>;
  /** The wallet, opened at zero (with its account) the first time it is asked for. */
  wallet(accountType: string, accountUuid: string, currencyId: number, at: string): Promise<EconomyWallet>;
  setWallet(accountType: string, accountUuid: string, currencyId: number, amount: number, at: string): Promise<EconomyWallet>;
  log(entry: LogEntry, at: string): Promise<void>;

  saveItem(item: MarketItem): Promise<void>;
  item(marketName: string, itemIndex: number): Promise<MarketItem | undefined>;
  items(marketName: string): Promise<MarketItem[]>;
  markets(): Promise<string[]>;
  deleteItem(marketName: string, itemIndex: number): Promise<boolean>;

  logKill(kill: SlayerKill): Promise<void>;
  logReward(reward: SlayerReward): Promise<void>;
  kills(playerUuid: string, limit: number): Promise<SlayerKill[]>;
  rewards(playerUuid: string, limit: number): Promise<SlayerReward[]>;
}

type Db = Kysely<Database> | Transaction<Database>;

async function ensureAccountIn(db: Db, accountType: string, accountUuid: string, at: string): Promise<EconomyAccount> {
  const found = await db
    .selectFrom('mceconomy_accounts')
    .selectAll()
    .where('account_type', '=', accountType)
    .where('account_uuid', '=', accountUuid)
    .executeTakeFirst();
  if (found !== undefined) return found;
  const row = { account_type: accountType, account_uuid: accountUuid, created_at: at, updated_at: at };
  await db.insertInto('mceconomy_accounts').values(row).execute();
  return row;
}

export function createCentralEconomyRepository(db: Kysely<Database>): CentralEconomyRepository {
  const walletRow = (trx: Db, accountType: string, accountUuid: string, currencyId: number) =>
    trx
      .selectFrom('mceconomy_wallets')
      .selectAll()
      .where('account_type', '=', accountType)
      .where('account_uuid', '=', accountUuid)
      .where('currency_id', '=', currencyId)
      .executeTakeFirst();

  const currencyBy = (trx: Db, systemCode: string) =>
    trx.selectFrom('mceconomy_currencies').selectAll().where('system_code', '=', systemCode).executeTakeFirst();

  return {
    ensureAccount: (accountType, accountUuid, at) =>
      db.transaction().execute((trx) => ensureAccountIn(trx, accountType, accountUuid, at)),

    account: (accountType, accountUuid) =>
      db
        .selectFrom('mceconomy_accounts')
        .selectAll()
        .where('account_type', '=', accountType)
        .where('account_uuid', '=', accountUuid)
        .executeTakeFirst(),

    saveCurrency: (systemCode, displayName, transferable, at) =>
      db.transaction().execute(async (trx) => {
        const existing = await currencyBy(trx, systemCode);
        if (existing === undefined) {
          await trx
            .insertInto('mceconomy_currencies')
            .values({
              system_code: systemCode,
              display_name: displayName,
              is_transferable: transferable,
              created_at: at,
              updated_at: at,
            })
            .execute();
        } else {
          await trx
            .updateTable('mceconomy_currencies')
            .set({ display_name: displayName, is_transferable: transferable, updated_at: at })
            .where('id', '=', existing.id)
            .execute();
        }
        return (await currencyBy(trx, systemCode))!;
      }),

    currencies: () => db.selectFrom('mceconomy_currencies').selectAll().orderBy('id').execute(),

    async currencyExists(id) {
      return (
        (await db.selectFrom('mceconomy_currencies').select('id').where('id', '=', id).executeTakeFirst()) !==
        undefined
      );
    },

    wallet: (accountType, accountUuid, currencyId, at) =>
      db.transaction().execute(async (trx) => {
        const found = await walletRow(trx, accountType, accountUuid, currencyId);
        if (found !== undefined) return found;
        await ensureAccountIn(trx, accountType, accountUuid, at);
        const row = {
          account_type: accountType,
          account_uuid: accountUuid,
          currency_id: currencyId,
          amount: 0,
          created_at: at,
          updated_at: at,
        };
        await trx.insertInto('mceconomy_wallets').values(row).execute();
        return row;
      }),

    setWallet: (accountType, accountUuid, currencyId, amount, at) =>
      db.transaction().execute(async (trx) => {
        const found = await walletRow(trx, accountType, accountUuid, currencyId);
        if (found === undefined) {
          await ensureAccountIn(trx, accountType, accountUuid, at);
          await trx
            .insertInto('mceconomy_wallets')
            .values({
              account_type: accountType,
              account_uuid: accountUuid,
              currency_id: currencyId,
              amount,
              created_at: at,
              updated_at: at,
            })
            .execute();
        } else {
          await trx
            .updateTable('mceconomy_wallets')
            .set({ amount, updated_at: at })
            .where('account_type', '=', accountType)
            .where('account_uuid', '=', accountUuid)
            .where('currency_id', '=', currencyId)
            .execute();
        }
        return (await walletRow(trx, accountType, accountUuid, currencyId))!;
      }),

    async log(entry, at) {
      await db
        .insertInto('mceconomy_logs')
        .values({
          account_type: entry.accountType,
          account_uuid: entry.accountUuid,
          scope: entry.scope,
          currency_id: entry.currencyId,
          amount: entry.amount,
          transaction_uuid: entry.transactionUuid,
          reference_type: entry.referenceType,
          reference_id: entry.referenceId,
          created_at: at,
        })
        .execute();
    },

    saveItem: (item) =>
      db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('market_items')
          .where('market_name', '=', item.market_name)
          .where('item_index', '=', item.item_index)
          .execute();
        await trx.insertInto('market_items').values(item).execute();
      }),

    item: (marketName, itemIndex) =>
      db
        .selectFrom('market_items')
        .selectAll()
        .where('market_name', '=', marketName)
        .where('item_index', '=', itemIndex)
        .executeTakeFirst(),

    items: (marketName) =>
      db.selectFrom('market_items').selectAll().where('market_name', '=', marketName).orderBy('item_index').execute(),

    async markets() {
      const rows = await db.selectFrom('market_items').select('market_name').distinct().orderBy('market_name').execute();
      return rows.map((r) => r.market_name);
    },

    async deleteItem(marketName, itemIndex) {
      const result = await db
        .deleteFrom('market_items')
        .where('market_name', '=', marketName)
        .where('item_index', '=', itemIndex)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async logKill(kill) {
      await db.insertInto('slayerrewards_kills').values(kill).execute();
    },

    async logReward(reward) {
      await db.insertInto('slayerrewards_rewards').values(reward).execute();
    },

    kills: (playerUuid, limit) =>
      db
        .selectFrom('slayerrewards_kills')
        .select(['player_uuid', 'mob_type', 'world', 'x', 'y', 'z', 'created_at'])
        .where('player_uuid', '=', playerUuid)
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),

    rewards: (playerUuid, limit) =>
      db
        .selectFrom('slayerrewards_rewards')
        .select(['player_uuid', 'mob_type', 'currency', 'amount', 'created_at'])
        .where('player_uuid', '=', playerUuid)
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),
  };
}
