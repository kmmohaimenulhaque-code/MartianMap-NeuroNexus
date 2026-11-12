---
title: NeuroNexus Marswalk
emoji: 🪐
colorFrom: blue
colorTo: red
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Meter-scale Marswalk planner built on NASA mission data
---

# NeuroNexus · Interplanetary Survival Guide: Martian Map

NASA Space Apps Challenge 2026 project by Team NeuroNexus.

Source code and documentation: https://github.com/kmmohaimenulhaque-code/martian-map
(branch `feature/mission-console-v2`).

This Space builds the repository at a pinned commit (see `Dockerfile`, `NN_REF`). MOLA terrain is
downloaded from the NASA PDS Geosciences Node at build time. All values in the console carry their
evidence class and source. Planning limits are not safety limits.

This project is not endorsed by NASA or any partner agency.
