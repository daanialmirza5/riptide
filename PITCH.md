# Riptide: 3-minute pitch and judge Q&A

## The pitch (about 3 minutes)

**0:00 Problem (20 s)**
"When one service fails in production, it rarely fails alone. A memory leak in payments becomes a checkout outage, then a homepage outage. On-call engineers find out from the alerts, after customers do. Track 01 asked us to predict that cascade, find the root cause, and pick the best recovery before the system crashes."

**0:20 Live demo: prediction (50 s)**
Open the Command Center. "This is a live digital twin of a 20-service e-commerce platform. Every dot is a real request."
Chaos lab → *Payment memory leak*. "I've just shipped a leaky release. Nothing is red yet, but watch payment's risk ring." Point at the Forecast tab: *heap rising 0.5%/s, limit in ~80 s*, and the predicted wavefront *payment → checkout → gateway*.
"Riptide never saw what I injected. It reads metrics and logs only."

**1:10 Root cause (25 s)**
Root cause tab: "Memory leak in Payment, 100% confidence. The evidence is listed: heap slope, the release that came right before it, GC-pause logs, and healthy downstream dependencies. It also shows the exact path the failure will take."

**1:35 Recovery: the differentiator (40 s)**
Click *Recover*. "This is what no dashboard does. Riptide forks the system once per possible fix and plays out the next two minutes of each." Point at the chart. "Doing nothing: payment crashes and checkout goes with it. A restart only buys time, because the leak comes back. A rollback keeps 99.8% availability with zero services lost." Click *Apply*.

**2:15 Autopilot + proof (35 s)**
Turn on Autopilot, inject *Cache node failure*, hands off. "Now it heals itself: detect, diagnose, simulate, act." While it recovers, open Benchmark: "We don't ask you to trust a demo. We replayed every failure class on independent twins. 100% correct root cause, named before anything failed, about 39 seconds of warning on average, 94% availability against 71% doing nothing, and zero false alarms."

**2:50 Close (10 s)**
"Riptide tells you which service fails next, why, and which fix actually works, while the system is still standing."

## Likely judge questions

**"Isn't it easy to score 100% on a simulator you wrote yourself?"**
Yes, and we say so on the page. The benchmark shows the whole pipeline works end to end and reacts in the right order. It isn't a claim about production accuracy. What carries over is the method: baselines learned only while healthy, trend-to-threshold forecasting, graph propagation, PageRank root cause, and counterfactual simulation. The Log Analyzer shows the same ideas working on log files we didn't write the scenario for.

**"Is this real AI or just rules?"**
It's a hybrid, on purpose. Learned statistical baselines (EWMA mean and variance per metric) drive anomaly detection. Regression forecasts time to failure. Probabilistic noisy-OR inference spreads risk over the dependency graph. Personalised PageRank ranks root causes (the MicroRCA approach from the research literature). Model-based planning simulates the fixes. Every number can be explained. In operations that matters more than a black box: an engineer won't roll back production on a guess they can't see into.

**"How would this work on a real system?"**
Swap the twin's metrics for Prometheus or OpenTelemetry, take the dependency graph from tracing (Jaeger or Tempo service maps), and send logs to the analyzer. Action execution maps to Kubernetes rollbacks and scaling, Istio circuit breakers and feature flags. For the counterfactual twin, you would calibrate a queueing model per service from historical telemetry.

**"What if the recommendation is wrong?"**
Every strategy is compared against doing nothing, and doing nothing wins when no fix helps. Risk is scored per action (a failover is riskier than a rollback). Autopilot only acts when the diagnosis is confident and isn't "unknown", and it waits after each action. Without Autopilot, a human approves every fix.

**"Why 3D?"**
Cascades are a graph problem across tiers. The layered 3D view shows the edge, application and data tiers at once, so you can literally watch a failure climb from the database to the homepage. Every fact in it is also in plain panels, so it's a visual aid, not a gimmick.

## Pre-demo checklist
- `docker compose up --build` (or uvicorn plus a built frontend). Open `http://localhost:8000`, then press **Reset** in the console.
- Set speed to **1x** for the narrated parts and **2x** while waiting for recovery.
- Open the Benchmark page once beforehand (it pre-computes on server start, which takes about 25 s).
- Use Chrome or Edge with hardware acceleration on, for the 3D view.
