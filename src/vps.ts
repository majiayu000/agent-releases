import { Database, type SQLQueryBindings } from "bun:sqlite";
import { runPublisher, type PublicationDatabase, type PublicationStatement } from "./worker.ts";

class SqliteStatement implements PublicationStatement {
  constructor(private db: Database, private sql: string, private values: SQLQueryBindings[] = []) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, values as SQLQueryBindings[]);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.query(this.sql).get(...this.values) as Record<string, unknown> | null;
    if (row === null) return null;
    if (column !== undefined && !(column in row)) throw new Error(`Missing result column: ${column}`);
    return (column === undefined ? row : row[column]) as T;
  }

  execute(): { meta: { changes: number } } {
    return { meta: { changes: this.db.query(this.sql).run(...this.values).changes } };
  }

  async run(): Promise<{ meta: { changes: number } }> { return this.execute(); }
}

export class SqliteDatabase implements PublicationDatabase {
  constructor(readonly connection: Database) {}
  prepare(sql: string): SqliteStatement { return new SqliteStatement(this.connection, sql); }
  async batch(statements: SqliteStatement[]): Promise<{ meta: { changes: number } }[]> {
    return this.connection.transaction(() => statements.map(statement => statement.execute()))();
  }
}

// This deployment is deliberately preview-only. Even DRY_RUN=false cannot enable X.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("Usage: bun run src/vps.ts /absolute/path/to/snapshot.sqlite (preview only)");
  const connection = new Database(args[0]!, { readonly: true, strict: true });
  try {
    await runPublisher(new SqliteDatabase(connection), true);
  } finally {
    connection.close();
  }
}
