# Databricks notebook source
# MAGIC %md
# MAGIC # HokieLens — student-success impact
# MAGIC
# MAGIC **Deloitte x Databricks demo.** HokieLens is a Virginia Tech registration planner.
# MAGIC Registration says a set of CRNs can be taken together. This notebook shows what
# MAGIC taking them together actually costs: schedule risk, impossible walks, and
# MAGIC course difficulty. Scores come from the committed HokieLens engine — this
# MAGIC notebook visualizes them; it does not recompute them.
# MAGIC
# MAGIC Catalog is a small calibrated synthetic term (fictional CRNs `9000x`). Heuristic,
# MAGIC not a prediction of any student's grades.

# COMMAND ----------

from pyspark.sql import functions as F

# Try repo / FileStore paths; fall back to the calibrated fixture table so the
# demo still runs if the CSVs have not been uploaded yet.

CANDIDATES = [
    "file:/Workspace/Repos/hokielens/backend/sponsors/databricks/schedules.csv",
    "/FileStore/hokielens/schedules.csv",
    "schedules.csv",
]


def _load_schedules():
    for path in CANDIDATES:
        try:
            frame = (
                spark.read.option("header", True)
                .option("inferSchema", True)
                .csv(path)
            )
            if frame.count() > 0:
                return frame, path
        except Exception:
            continue
    rows = [
        ("easy", "Balanced schedule", "analyze", 41, 41, 0, 3.32, 3, 0, 3, 9),
        ("brutal", "The wall of pain", "analyze", 84, 84, 0, 2.99, 5, 2, 6, 16),
        ("easy", "Balanced schedule", "miss_week_8", 41, 46, 5, 3.32, 3, 0, 3, 9),
        ("swap", "swap_demo before", "swap_before", 49, 49, 0, 3.14, 3, 0, 3, 9),
        ("swap", "swap_demo after", "swap_after", 19, 19, -30, 2.96, 3, 0, 0, 9),
    ]
    cols = [
        "schedule_id",
        "label",
        "scenario",
        "risk_score",
        "stressed_risk",
        "delta",
        "gpa_mean",
        "n_sections",
        "n_tight",
        "n_impossible",
        "credits",
    ]
    return spark.createDataFrame(rows, cols), "inline_calibrated_fixtures"


schedules, source = _load_schedules()
print(f"loaded schedules from {source}")
display(schedules.orderBy("schedule_id", "scenario"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## The story in four numbers
# MAGIC
# MAGIC | Student week | Risk | What a judge should see |
# MAGIC |---|---|---|
# MAGIC | Balanced (`easy`) | **41** | Lower load, catalog GPA ~3.32. Walking pressure is still visible. |
# MAGIC | Wall of pain (`brutal`) | **84** | Same catalog, stacked difficulty plus more walks that do not fit. |
# MAGIC | One section swap | **49 -> 19** | Drop one collision (delta **-30**) and the commute warnings clear. |
# MAGIC | Miss week 8 | **41 -> 46** | A single absence adds a small, explained penalty, not a black-box spike. |
# MAGIC
# MAGIC That is the student-performance case: **commute problems and course difficulty
# MAGIC are visible before add/drop**, using the same data a registrar already publishes
# MAGIC in pieces.

# COMMAND ----------

summary = (
    schedules.filter(
        F.col("scenario").isin("analyze", "swap_before", "swap_after", "miss_week_8")
    )
    .select(
        "schedule_id",
        "scenario",
        "risk_score",
        "stressed_risk",
        "delta",
        "n_impossible",
        "n_tight",
        "gpa_mean",
        "credits",
    )
    .orderBy("schedule_id", "scenario")
)
display(summary)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Risk versus walking failure
# MAGIC
# MAGIC Brutal weeks fail on *logistics*, not just GPA. Impossible walks are meetings
# MAGIC the student physically cannot make. Databricks is the place to show that
# MAGIC join: risk score next to commute failures, on one table, for advisors.

# COMMAND ----------

compare = (
    schedules.filter(F.col("scenario") == "analyze")
    .select("label", "risk_score", "n_impossible", "n_tight", "gpa_mean", "credits")
)
display(compare)

# COMMAND ----------

# MAGIC %md
# MAGIC ## How to demo (90 seconds)
# MAGIC
# MAGIC 1. Open this notebook in the Databricks workspace (Community Edition is enough).
# MAGIC 2. Run all cells. Point at the **41 vs 84** row, then the **49 → 19** swap.
# MAGIC 3. Say: HokieLens is the agent that scores a VT week; Databricks is where
# MAGIC    advising staff would watch the impact.
# MAGIC 4. Optional: upload `backend/sponsors/databricks/*.csv` to `/FileStore/hokielens/`
# MAGIC    and re-run so `display` reads the live export instead of the inline fallback.
# MAGIC
# MAGIC Regenerate CSVs from the repo (no Spark, no token)::
# MAGIC
# MAGIC ```
# MAGIC cd backend
# MAGIC python -m sponsors.impact --write
# MAGIC ```
