import {
  OperationNodeTransformer,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type PrimitiveValueListNode,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
  type ValueNode,
} from 'kysely';

const TIMESTAMP_COLUMN = /(^|_)(at)$/;
const BOOLEAN_COLUMN = /^(is_|has_)/;

/**
 * Normalizes what the three drivers hand back so a repository never has to know
 * which one it is talking to.
 *
 * PostgreSQL and MySQL return a `Date` for a timestamp column and SQLite returns
 * the string it stored; SQLite and MySQL return `1`/`0` for a boolean and
 * PostgreSQL returns a real one. Without this, every caller either branches on
 * the provider or is quietly wrong on three of the four.
 *
 * Columns are recognised by name — `*_at` is a timestamp, `is_*` and `has_*` are
 * booleans — which is a convention the schema follows deliberately so this
 * plugin needs no table map to maintain alongside it.
 */
export class NormalizeRowsPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(
    args: PluginTransformResultArgs,
  ): Promise<QueryResult<UnknownRow>> {
    for (const row of args.result.rows) {
      for (const key of Object.keys(row)) {
        const value = row[key];
        if (value === null || value === undefined) continue;

        if (TIMESTAMP_COLUMN.test(key) && value instanceof Date) {
          row[key] = value.toISOString();
        } else if (BOOLEAN_COLUMN.test(key) && typeof value === 'number') {
          row[key] = value !== 0;
        } else if (typeof value === 'bigint') {
          // `bigint` columns come back as BigInt on some drivers. Sizes and
          // quotas are well inside Number.MAX_SAFE_INTEGER, and a BigInt does
          // not survive JSON.stringify.
          row[key] = Number(value);
        }
      }
    }
    return args.result;
  }
}

/**
 * Rewrites bound booleans to `1`/`0` on the way into the query.
 *
 * better-sqlite3 binds numbers, strings, bigints, buffers and null, and throws
 * on a boolean — so `is_primary: false` fails at the driver rather than at the
 * type system. SQLite has no boolean type at all; the schema stores an integer,
 * and `NormalizeRowsPlugin` turns it back into a boolean on the way out.
 *
 * Applied only to SQLite. `pg` and `mysql2` both accept a boolean directly, and
 * converting for them would mean writing `1` into a real `boolean` column.
 */
class BooleanToIntegerTransformer extends OperationNodeTransformer {
  protected override transformValue(node: ValueNode): ValueNode {
    const transformed = super.transformValue(node);
    if (typeof transformed.value !== 'boolean') return transformed;
    return { ...transformed, value: transformed.value ? 1 : 0 };
  }

  protected override transformPrimitiveValueList(
    node: PrimitiveValueListNode,
  ): PrimitiveValueListNode {
    const transformed = super.transformPrimitiveValueList(node);
    if (!transformed.values.some((v) => typeof v === 'boolean')) return transformed;
    return {
      ...transformed,
      values: transformed.values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)),
    };
  }
}

export class SqliteBooleanPlugin implements KyselyPlugin {
  readonly #transformer = new BooleanToIntegerTransformer();

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(args.node);
  }

  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return Promise.resolve(args.result);
  }
}
