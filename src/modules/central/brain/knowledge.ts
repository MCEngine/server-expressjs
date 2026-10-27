import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';
import { insertSerial } from '../../../db/serial.js';
import { cosine, parseVector, topK } from '../../../lib/vectors.js';

export interface KnowledgeEntry {
  id: number;
  title: string;
  content: string;
  source: string | null;
  created_at: string;
}

/** The pages an operator adds for the brain to search. */
export interface KnowledgeRepository {
  add(entry: { title: string; content: string; source: string | null }, modelName: string, embedding: readonly number[], at: string): Promise<KnowledgeEntry>;
  list(limit: number): Promise<KnowledgeEntry[]>;
  remove(id: number): Promise<boolean>;
  search(modelName: string, query: readonly number[], limit: number): Promise<(KnowledgeEntry & { similarity: number })[]>;
}

export function createKnowledgeRepository(db: Kysely<Database>): KnowledgeRepository {
  return {
    add: (entry, modelName, embedding, at) =>
      db.transaction().execute(async (trx) => {
        const id = await insertSerial(trx, 'mcagents_knowledge', { ...entry, created_at: at });
        await trx
          .insertInto('mcagents_knowledge_embeddings')
          .values({ knowledge_id: id, model_name: modelName, embedding: JSON.stringify(embedding) })
          .execute();
        return { id, ...entry, created_at: at };
      }),

    list: (limit) => db.selectFrom('mcagents_knowledge').selectAll().orderBy('id', 'desc').limit(limit).execute(),

    async remove(id) {
      const result = await db.deleteFrom('mcagents_knowledge').where('id', '=', id).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async search(modelName, query, limit) {
      const rows = await db
        .selectFrom('mcagents_knowledge_embeddings')
        .innerJoin('mcagents_knowledge', 'mcagents_knowledge.id', 'mcagents_knowledge_embeddings.knowledge_id')
        .select([
          'mcagents_knowledge.id',
          'mcagents_knowledge.title',
          'mcagents_knowledge.content',
          'mcagents_knowledge.source',
          'mcagents_knowledge.created_at',
          'mcagents_knowledge_embeddings.embedding',
        ])
        .where('mcagents_knowledge_embeddings.model_name', '=', modelName)
        .execute();
      return topK(rows, (row) => cosine(query, parseVector(row.embedding)), limit).map(({ item, score }) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        source: item.source,
        created_at: item.created_at,
        similarity: score,
      }));
    },
  };
}
