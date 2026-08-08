/**
 * The minimum a Postgres driver must provide.
 *
 * Deliberately tiny so no driver is a dependency yet: `pg`, `postgres.js`, and
 * Neon's serverless client all satisfy this in a few lines of adapter. It also
 * makes the SQL testable without a database — a recording client captures the
 * exact text and parameters, which is where a scoping mistake would show up.
 */

export interface SqlClient {
  /** Parameterised query. Values are never interpolated into the text. */
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

export interface TransactionalSqlClient extends SqlClient {
  transaction<T>(work: (tx: SqlClient) => Promise<T>): Promise<T>;
}

/**
 * A tagged template that builds parameterised SQL.
 *
 * Every interpolated value becomes a placeholder, so there is no path by which
 * a caller can concatenate a value into the statement — the type system will
 * not let them hand a string to the driver directly.
 */
export interface Sql {
  text: string;
  params: unknown[];
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  let text = strings[0];
  const params: unknown[] = [];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    // A nested fragment splices its text in and renumbers its parameters,
    // which is what makes composable WHERE clauses possible without string
    // building at the call site.
    if (isSql(value)) {
      text += renumber(value, params.length) + strings[i + 1];
      params.push(...value.params);
    } else {
      params.push(value);
      text += `$${params.length}` + strings[i + 1];
    }
  }

  return { text, params };
}

function isSql(value: unknown): value is Sql {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    "params" in value
  );
}

/** Shift `$1, $2 …` in a fragment so it continues the outer numbering. */
function renumber(fragment: Sql, offset: number): string {
  return fragment.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

/** Join fragments, e.g. a list of AND-ed conditions. */
export function joinSql(fragments: Sql[], separator: string): Sql {
  if (fragments.length === 0) return { text: "", params: [] };
  let text = "";
  const params: unknown[] = [];
  fragments.forEach((fragment, index) => {
    if (index > 0) text += separator;
    text += renumber(fragment, params.length);
    params.push(...fragment.params);
  });
  return { text, params };
}
