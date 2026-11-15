#!/usr/bin/env python3
"""
scripts/duckdb-query.py
In-process DuckDB 1.5.5 SQL runner for VeriSieve UI & CLI.
Reads JSON payload from stdin: { "sql": str, "dataset": str }
Outputs JSON with columns, rows, and execution metrics.
"""

import os
import sys
import json
import time
import duckdb

def main():
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {}
        sql = payload.get('sql', 'SELECT * FROM raw_extracted_documents LIMIT 10;')
        dataset = payload.get('dataset', 'all')

        results_dir = os.path.abspath('results')
        pmc_csv = os.path.join(results_dir, 'real-data-pmc-pdf.csv').replace('\\', '/')
        funsd_csv = os.path.join(results_dir, 'real-data-funsd-noisy-ocr.csv').replace('\\', '/')

        con = duckdb.connect(':memory:')

        # Set up default tables/views
        if os.path.exists(pmc_csv):
            con.execute(f"CREATE TABLE pmc_pdf_data AS SELECT * FROM read_csv_auto('{pmc_csv}');")
        if os.path.exists(funsd_csv):
            con.execute(f"CREATE TABLE funsd_ocr_data AS SELECT * FROM read_csv_auto('{funsd_csv}');")

        if os.path.exists(pmc_csv) and os.path.exists(funsd_csv):
            con.execute(f"""
                CREATE TABLE raw_extracted_documents AS
                SELECT * FROM pmc_pdf_data
                UNION ALL BY NAME
                SELECT * FROM funsd_ocr_data;
            """)
            con.execute("CREATE VIEW documents AS SELECT * FROM raw_extracted_documents;")
        elif os.path.exists(pmc_csv):
            con.execute("CREATE TABLE raw_extracted_documents AS SELECT * FROM pmc_pdf_data;")
            con.execute("CREATE VIEW documents AS SELECT * FROM raw_extracted_documents;")

        t0 = time.perf_counter()
        rel = con.execute(sql)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        columns = [desc[0] for desc in rel.description] if rel.description else []
        fetched_rows = rel.fetchall()

        # Serialize rows cleanly
        formatted_rows = []
        for row in fetched_rows[:500]: # Cap at 500 rows for UI safety
            formatted_rows.append([None if v is None else (str(v) if isinstance(v, (bytes, bytearray)) else v) for v in row])

        output = {
            "ok": True,
            "engine": f"DuckDB v{duckdb.__version__}",
            "columns": columns,
            "rows": formatted_rows,
            "total_rows": len(fetched_rows),
            "elapsedMs": elapsed_ms
        }
        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "ok": False,
            "error": str(e),
            "engine": f"DuckDB v{duckdb.__version__}"
        }))

if __name__ == '__main__':
    main()
