"""Load the CMS Provider-and-Service CSV into DuckDB; keep individuals; write data/work/ps.parquet.

HCPCS_Desc (AMA CPT descriptor text) and street addresses are dropped here and never leave this step.
Locality is assigned from the provider's practice ZIP5 (data/work/zip5.csv; run build_zip.py first).
Usage: python -I pipeline/npi/build_ps.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402


def main() -> None:
    con = duckdb.connect()
    con.execute("PRAGMA threads=8")
    con.execute(
        "CREATE TABLE raw AS SELECT * FROM read_csv(?, header=true, all_varchar=true, quote='\"', escape='\"')",
        [str(c.PS_CSV)],
    )
    print("raw rows", con.execute("SELECT count(*) FROM raw").fetchone())
    print(con.execute("SELECT Rndrng_Prvdr_Ent_Cd, count(*) FROM raw GROUP BY 1").fetchall())
    con.execute("CREATE TABLE z AS SELECT * FROM read_csv(?, header=true, all_varchar=true)",
                [str(c.WORK / "zip5.csv")])
    con.execute("""
        CREATE TABLE ps AS
        SELECT
          trim(r.Rndrng_NPI)                                   AS npi,
          trim(r.Rndrng_Prvdr_Last_Org_Name)                   AS last_name,
          trim(coalesce(r.Rndrng_Prvdr_First_Name, ''))        AS first_name,
          trim(coalesce(r.Rndrng_Prvdr_MI, ''))                AS mi,
          trim(coalesce(r.Rndrng_Prvdr_Crdntls, ''))           AS credentials,
          trim(coalesce(r.Rndrng_Prvdr_City, ''))              AS city,
          trim(coalesce(r.Rndrng_Prvdr_State_Abrvtn, ''))      AS state,
          lpad(trim(coalesce(r.Rndrng_Prvdr_Zip5, '')), 5, '0') AS zip5,
          trim(coalesce(r.Rndrng_Prvdr_RUCA, ''))              AS ruca,
          trim(coalesce(r.Rndrng_Prvdr_Cntry, ''))             AS country,
          trim(r.Rndrng_Prvdr_Type)                            AS provider_type,
          trim(coalesce(r.Rndrng_Prvdr_Mdcr_Prtcptg_Ind, ''))  AS participating,
          z.loc_key                                            AS loc_key,
          upper(trim(r.HCPCS_Cd))                              AS hcpcs,
          trim(r.HCPCS_Drug_Ind)                               AS drug_ind,
          trim(r.Place_Of_Srvc)                                AS pos,
          CAST(r.Tot_Benes AS INTEGER)                         AS tot_benes,
          CAST(r.Tot_Srvcs AS DOUBLE)                          AS tot_srvcs,
          CAST(r.Tot_Bene_Day_Srvcs AS DOUBLE)                 AS tot_bene_day_srvcs,
          CAST(r.Avg_Sbmtd_Chrg AS DOUBLE)                     AS avg_sbmtd_chrg,
          CAST(r.Avg_Mdcr_Alowd_Amt AS DOUBLE)                 AS avg_allowed,
          CAST(r.Avg_Mdcr_Pymt_Amt AS DOUBLE)                  AS avg_pymt,
          CAST(r.Avg_Mdcr_Stdzd_Amt AS DOUBLE)                 AS avg_stdzd
        FROM raw r
        LEFT JOIN z ON z.zip5 = lpad(trim(coalesce(r.Rndrng_Prvdr_Zip5, '')), 5, '0')
        WHERE r.Rndrng_Prvdr_Ent_Cd = 'I'
        ORDER BY npi, hcpcs, pos
    """)
    q = con.execute
    print("individual rows", q("SELECT count(*), count(DISTINCT npi) FROM ps").fetchone())
    print("no locality (rows, npis)", q("SELECT count(*), count(DISTINCT npi) FROM ps WHERE loc_key IS NULL").fetchone())
    print("countries", q("SELECT country, count(DISTINCT npi) FROM ps GROUP BY 1 ORDER BY 2 DESC").fetchall())
    print("pos", q("SELECT pos, count(*) FROM ps GROUP BY 1").fetchall())
    print("drug_ind", q("SELECT drug_ind, count(*) FROM ps GROUP BY 1").fetchall())
    print("NPIs with >1 name/zip/type",
          q("SELECT count(*) FROM (SELECT npi FROM ps GROUP BY npi HAVING count(DISTINCT last_name||first_name||zip5||provider_type) > 1)").fetchone())
    print("dup (npi,hcpcs,pos)", q("SELECT count(*) FROM (SELECT 1 FROM ps GROUP BY npi,hcpcs,pos HAVING count(*)>1)").fetchone())
    q(f"COPY ps TO '{c.PS_PARQUET}' (FORMAT parquet, COMPRESSION zstd)")
    print("wrote", c.PS_PARQUET, c.PS_PARQUET.stat().st_size)


if __name__ == "__main__":
    main()
