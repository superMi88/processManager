import { Client } from "pg";
import { readStore, buildDatabaseUrl } from "./resource-store";

export interface TableInfo {
  name: string;
  columnCount: number;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
}

export interface QueryRowsOptions {
  filters?: { column: string; operator: string; value: unknown }[];
  sortColumn?: string;
  sortDirection?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}

export interface QueryRowsResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  limit: number;
  offset: number;
}

/**
 * Connect to a postgres database and return a client and the configured schema
 */
export async function getDbClient(dbId: string): Promise<{ client: Client; schema: string }> {
  const store = readStore();
  const db = store.databases.find((d) => d.id === dbId);
  if (!db) {
    throw new Error(`Datenbank mit ID '${dbId}' wurde nicht in den registrierten Ressourcen gefunden.`);
  }
  if (db.type !== "postgres") {
    throw new Error(`Datenbank-Browser wird aktuell nur für PostgreSQL unterstützt. '${db.alias}' ist eine ${db.type} Datenbank.`);
  }

  const connectionString = buildDatabaseUrl(db);
  if (!connectionString) {
    throw new Error(`Verbindungs-URL für Datenbank '${db.alias}' konnte nicht generiert werden.`);
  }

  // Create client and connect
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Verbindung zur Datenbank fehlgeschlagen: ${errMsg}`);
  }

  return { client, schema: db.schema || "public" };
}

/**
 * Retrieve user tables and column counts in the configured schema
 */
export async function getTables(dbId: string): Promise<TableInfo[]> {
  const { client, schema } = await getDbClient(dbId);
  try {
    const query = `
      SELECT 
        table_name as name,
        (
          SELECT count(*)::int
          FROM information_schema.columns 
          WHERE table_name = t.table_name AND table_schema = t.table_schema
        ) as column_count
      FROM information_schema.tables t
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const result = await client.query(query, [schema]);
    return result.rows.map((row) => ({
      name: row.name,
      columnCount: row.column_count,
    }));
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

/**
 * Retrieve column metadata for a specific table
 */
export async function getColumns(dbId: string, tableName: string): Promise<ColumnMeta[]> {
  const { client, schema } = await getDbClient(dbId);
  try {
    // 1. Verify table exists to prevent SQL Injection in table names
    const tableCheck = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'",
      [schema, tableName]
    );
    if (tableCheck.rowCount === 0) {
      throw new Error(`Tabelle '${tableName}' existiert nicht im Schema '${schema}'.`);
    }

    // 2. Query columns and detect primary keys
    const query = `
      SELECT 
        c.column_name as name,
        c.data_type as data_type,
        c.is_nullable as is_nullable,
        c.column_default as column_default,
        (
          SELECT count(*)::int
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = c.table_schema
            AND tc.table_name = c.table_name
            AND kcu.column_name = c.column_name
        ) > 0 as is_primary_key
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;
    const result = await client.query(query, [schema, tableName]);
    return result.rows.map((row) => ({
      name: row.name,
      dataType: row.data_type,
      isNullable: row.is_nullable === "YES",
      columnDefault: row.column_default,
      isPrimaryKey: row.is_primary_key,
    }));
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

/**
 * Securely query rows from a table with filters, sort, and pagination
 */
export async function queryRows(
  dbId: string,
  tableName: string,
  options: QueryRowsOptions
): Promise<QueryRowsResult> {
  const { client, schema } = await getDbClient(dbId);
  try {
    // 1. Fetch valid columns to build a safe column lookup list
    const columns = await getColumns(dbId, tableName);
    const columnNames = columns.map((c) => c.name);

    const limit = options.limit ? Math.max(1, Math.min(1000, options.limit)) : 50;
    const offset = options.offset ? Math.max(0, options.offset) : 0;

    const whereClauses: string[] = [];
    const queryParams: unknown[] = [];
    let paramIdx = 1;

    // 2. Safely parse and build filter conditions
    if (options.filters && Array.isArray(options.filters)) {
      for (const filter of options.filters) {
        // Enforce column exists in actual db metadata (blocks SQL injection)
        if (!columnNames.includes(filter.column)) {
          continue;
        }

        const op = filter.operator.toLowerCase();
        const colIdentifier = `"${filter.column}"`;

        if (op === "is_null") {
          whereClauses.push(`${colIdentifier} IS NULL`);
        } else if (op === "is_not_null") {
          whereClauses.push(`${colIdentifier} IS NOT NULL`);
        } else if (["=", "!=", ">", "<", ">=", "<="].includes(op)) {
          whereClauses.push(`${colIdentifier} ${op} $${paramIdx}`);
          queryParams.push(filter.value);
          paramIdx++;
        } else if (op === "like" || op === "ilike") {
          whereClauses.push(`${colIdentifier} ${op === "like" ? "LIKE" : "ILIKE"} $${paramIdx}`);
          const val = String(filter.value);
          const wrappedVal = val.includes("%") ? val : `%${val}%`;
          queryParams.push(wrappedVal);
          paramIdx++;
        }
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // 3. Query total count matching filter
    const countQuery = `SELECT COUNT(*)::int as total FROM "${schema}"."${tableName}" ${whereSql}`;
    const countResult = await client.query(countQuery, queryParams);
    const totalCount = countResult.rows[0]?.total || 0;

    // 4. Build ORDER BY
    let orderSql = "";
    if (options.sortColumn && columnNames.includes(options.sortColumn)) {
      const dir = options.sortDirection === "DESC" ? "DESC" : "ASC";
      orderSql = `ORDER BY "${options.sortColumn}" ${dir}`;
    } else {
      // Default fallback ordering
      const pk = columns.find((c) => c.isPrimaryKey);
      if (pk) {
        orderSql = `ORDER BY "${pk.name}" ASC`;
      } else if (columnNames.length > 0) {
        orderSql = `ORDER BY "${columnNames[0]}" ASC`;
      }
    }

    // 5. Query final page of records (using safe integers for LIMIT/OFFSET)
    const selectQuery = `
      SELECT * 
      FROM "${schema}"."${tableName}" 
      ${whereSql} 
      ${orderSql} 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await client.query(selectQuery, queryParams);

    return {
      rows: result.rows,
      totalCount,
      limit,
      offset,
    };
  } finally {
    try {
      await client.end();
    } catch {}
  }
}
