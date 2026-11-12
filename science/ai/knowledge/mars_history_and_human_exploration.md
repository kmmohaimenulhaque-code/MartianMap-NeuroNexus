---
title: Mars — observation history and human exploration reference
evidence_class: NASA REFERENCE
as_of: 2026-10
sources: NASA Science Mars pages; NASA Moon to Mars Architecture (nasa.gov/moontomarsarchitecture); NASA Human Research Program; Hassler et al. 2014; NASA MOXIE results (Hoffman et al. 2022); Clancy et al. 2000
---

## Observation history
- Ancient astronomers tracked Mars' retrograde loops. Its red colour linked it to war gods (Nergal, Ares, Mars).
- Galileo first observed Mars telescopically in 1610.
- Christiaan Huygens drew the first surface feature, Syrtis Major, in 1659 and estimated the rotation period. Giovanni Cassini refined the period and noted the polar caps (1666).
- William Herschel measured the axial tilt and noted seasonal polar cap changes (1780s).
- 1877 opposition: Giovanni Schiaparelli mapped "canali" (channels), mistranslated as "canals". Asaph Hall discovered Phobos and Deimos.
- Percival Lowell (1890s–1910s) popularised the idea of artificial canals. Better telescopes (Antoniadi, 1909) and later Mariner 4 (1965) showed the canals were optical illusions.
- Spacecraft era: see the missions reference. Key paradigm shifts:
  - Mariner 4 showed a Moon-like cratered planet.
  - Mariner 9 revealed volcanoes, canyons and ancient channels.
  - Viking searched for life.
  - MGS, Odyssey, MRO and the rovers established a wet, potentially habitable ancient Mars.

## Mars time keeping
- A sol is 24 h 39 m 35 s. Mission teams count sols from landing (Curiosity sol 0 = 6 August 2012).
- Local Mean Solar Time (LMST) and Local True Solar Time (LTST) are used for operations. "Mars time" shifts ~40 minutes later each Earth day, which is hard on ground crews.
- Coordinated Mars Time (MTC) is the mean solar time at the prime meridian (Airy-0 crater).
- Mars Year numbering (Clancy et al. 2000): MY 1 began 11 April 1955. The NeuroNexus dust scenario covers MY 34 (2017–2019), which includes the 2018 global dust storm.
- Longitude conventions: modern NASA and USGS products use planetocentric latitude and east-positive longitude 0–360° (NeuroNexus uses this). Older maps used planetographic latitude and west longitude.

## Human exploration: architecture and constraints
- Transit: Hohmann-like transfers take ~6–9 months each way. Departure windows open every ~26 months.
  - A conjunction-class mission lasts ~2.5–3 years in total with ~500 days on the surface.
  - An opposition-class mission is shorter overall (~1.5–2 years) but has only ~30–60 days on the surface and higher Δv.
- Entry, descent and landing for human-class payloads (tens of tonnes) is unsolved at scale. Supersonic retropropulsion and inflatable decelerators (e.g. LOFTID) are being matured.
- Communications delay is 3–22 min one way, and there is a ~2-week blackout at solar conjunction. Crews must operate autonomously; NeuroNexus' deterministic, offline-capable planning tools are designed with this in mind.
- Radiation: the surface dose is ~0.64 mSv/day (Curiosity RAD). Shielding options are regolith berms, water walls, lava tubes and subsurface habitats; storm shelters are needed for solar particle events.
- Dust:
  - fine, abrasive and electrostatically charged;
  - contains perchlorates (a thyroid toxin);
  - degrades seals, solar arrays and thermal radiators.
  Suitports, dust-tolerant mechanisms and airlock cleaning are required.
- Temperature: night lows below −80 °C are routine at mid-latitudes, so habitats, rovers and suits need active thermal control.
- Gravity: 0.38 g. Long-term health effects of partial gravity are unknown; crews arrive deconditioned after months in microgravity.
- Psychological factors: isolation, confinement and communication delay. Analog missions include HI-SEAS, MDRS and NASA CHAPEA (a 378-day habitat analog that concluded in July 2024).

## In-situ resource utilisation (ISRU)
- Oxygen from atmospheric CO₂ by solid-oxide electrolysis. Perseverance MOXIE produced 122 g O₂ in total, up to ~12 g/h at ~98% purity.
- Water from ground ice (mid and high latitudes) or hydrated minerals. Water is the key resource for life support, radiation shielding and propellant.
- Methane/oxygen propellant via the Sabatier reaction (CO₂ + H₂ → CH₄ + H₂O), the basis of many return-vehicle concepts.
- Regolith for shielding, construction (sintering, 3D printing) and agriculture after perchlorate removal.

## Selecting a human landing site / exploration zone
NASA's First Landing Site/Exploration Zone Workshop (2015) defined an Exploration Zone (EZ) as ~100 km in radius around a landing site. Criteria:
- Engineering:
  - latitude within ~±50° for solar power and thermal reasons;
  - low elevation (below about +2 km MOLA) so the atmosphere helps braking;
  - low slopes and rock abundance at the landing ellipse;
  - load-bearing surfaces.
- Resources: accessible water ice or hydrated minerals; potential construction materials.
- Science: Regions of Interest (ROIs) with diverse, ancient geology (astrobiology, climate, volcanism) within traverse range.
- Operations: safe traverses for pressurised rovers and EVA. Walkback distance to the habitat drives EVA planning.

NeuroNexus shows candidate Potential Exploration Zones in the 3D view. These are planning context, not certified sites.

## EVA and traverse planning concepts used in NeuroNexus
- EVA time is estimated from distance divided by pace, plus an ascent allowance (metres climbed per hour). In NeuroNexus the defaults are 2.5 km/h and 600 m/h, and both are user adjustable.
- Slope: Apollo-era and analog studies suggest walking becomes markedly harder above ~15° and rovers are commonly limited to ~15–30° depending on design.
- Roughness: here this means local elevation variability (m) in a 3×3 MOLA neighbourhood, a coarse (~460 m pixel) proxy. It does not resolve boulders; HiRISE-scale data is needed for that.
- Safe Haven: in NeuroNexus, a user-designated retreat point (habitat, cache, rover). Routes report the maximum distance from the nearest Safe Haven. This is a planning aid only; nothing in NeuroNexus certifies a location as safe.
