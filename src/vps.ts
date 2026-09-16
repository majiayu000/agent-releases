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

// Preview is the default. Publishing requires an explicit CLI flag, not an env toggle.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== "--publish")) {
    throw new Error("Usage: bun run src/vps.ts /absolute/path/to/state.sqlite [--publish]");
  }
  const preview = args[1] !== "--publish";
  const connection = new Database(args[0]!, { readonly: preview, readwrite: !preview, create: false, strict: true });
  try {
    await runPublisher(new SqliteDatabase(connection), preview);
    console.log(`[complete] mode=${preview ? "preview" : "publish"}`);
  } finally {
    connection.close();
  }
}
