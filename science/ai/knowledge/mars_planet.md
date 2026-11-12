---
title: Mars — planetary science reference
evidence_class: NASA REFERENCE
as_of: 2026-10
sources: NASA Mars Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html); NASA Science Mars pages (science.nasa.gov/mars); Smith et al. 2001 (MOLA); Hassler et al. 2014 (MSL RAD); Mahaffy et al. 2013 (MSL SAM); Montabone et al. 2015
---

## Bulk properties
- Mean radius 3,389.5 km (equatorial 3,396.2 km, polar 3,376.2 km). About 53% of Earth's radius.
- Mass 6.417 × 10^23 kg (≈ 10.7% of Earth). Mean density 3,933 kg/m³.
- Surface gravity 3.71–3.72 m/s² (≈ 0.38 g). A 100 kg astronaut-plus-suit system weighs as 38 kg would on Earth.
- Escape velocity 5.03 km/s. Low Mars orbit velocity ≈ 3.4–3.6 km/s.
- No global magnetic field today; strong crustal remanent magnetism in the southern highlands (Terra Cimmeria/Sirenum), mapped by Mars Global Surveyor.

## Orbit, day and year
- Semi-major axis 1.524 AU (227.9 million km); eccentricity 0.0934; perihelion 1.381 AU, aphelion 1.666 AU.
- Sidereal rotation 24 h 37 m 22.7 s. Solar day (sol) 24 h 39 m 35.2 s = 1.0275 Earth days.
- Orbital period 686.98 Earth days = about 668.6 sols. NeuroNexus' MY34 dust scenario has 668 daily (sol) bins.
- Obliquity (axial tilt) 25.19°, so Mars has seasons; its obliquity varies chaotically over millions of years (roughly 15°–45°), which drives ice-age-like climate cycles.
- Earth–Mars distance ranges from about 55 million km (close opposition) to about 400 million km (solar conjunction). One-way light time is ≈ 3 to 22 minutes.
- Synodic period (Earth–Mars alignment repeat) ≈ 780 days (~26 months): launch windows and solar conjunctions recur on this cadence. During solar conjunction (~2 weeks) commanding is suspended.

## Seasons and solar longitude (Ls)
- Seasons are tracked by areocentric solar longitude Ls: Ls 0° = northern spring equinox, 90° = northern summer solstice, 180° = northern autumn equinox, 270° = northern winter solstice.
- Because of the eccentric orbit, perihelion falls near Ls 251° (southern late spring/summer). Southern summers are shorter and hotter; northern summers longer and cooler.
- The dusty season is roughly Ls 180°–360° (southern spring/summer); regional storms are common then and planet-encircling (global) dust storms occur in some years.
- Mars Years (MY) follow the Clancy et al. (2000) convention: MY 1 began on 11 April 1955 (Ls 0). MY 34 began 5 May 2017; MY 35 began 23 March 2019; MY 37 began 26 December 2022; MY 38 began 12 November 2024.

## Atmosphere
- Composition (Curiosity SAM, Gale crater): ≈ 95% CO₂, ≈ 2.6–2.8% N₂, ≈ 1.9–2.0% Ar, ≈ 0.16–0.17% O₂, ≈ 0.06% CO, plus trace H₂O and other species. Exact fractions vary seasonally.
- Mean surface pressure ≈ 600 Pa (≈ 0.6% of Earth's). It varies by ~25–30% over the year as CO₂ freezes onto and sublimes from the seasonal polar caps, and strongly with elevation: ~1,100+ Pa in Hellas, well under 100 Pa at the top of Olympus Mons.
- 610 Pa is the reference "mean" pressure used to normalise dust optical depths (Montabone et al.).
- Temperatures: global mean ≈ 210 K (−63 °C). Surface extremes span roughly −125 °C (polar night, CO₂ frost point ≈ 148 K at 600 Pa) to about +20 °C (equatorial summer afternoons, dark surfaces). The thin air holds little heat, so diurnal swings of 70–100 K are normal.
- Liquid water is unstable at the surface almost everywhere: pressure is near the triple point of water (611.657 Pa).

## Dust, dust storms and dust devils
- Dust is the dominant short-term weather driver. Column dust optical depth (τ) is the standard measure: τ ≈ 0.2–0.5 is typical background; regional storms push τ above 1; global storms reach τ ≈ 5–10+ in visible wavelengths.
- Planet-encircling dust storms occurred in 1971 (Mariner 9 arrival), 1977 (two, Viking era), 2001, 2007 and 2018 (MY 34). The 2018 storm began near Ls ≈ 185° and ended the Opportunity rover's mission (power loss, last contact 10 June 2018).
- Dust lowers daytime surface temperature, raises atmospheric temperature, cuts solar-array output and increases electrostatic and abrasion hazards for hardware and EVA suits.
- Dust devils are common in spring and summer; they cleaned Spirit's and Opportunity's solar arrays several times.
- The Montabone et al. (2015) climatology reconstructs daily gridded column dust optical depth for MY 24 onward from orbiter (TES, THEMIS, MCS) retrievals. The NASA Ames Mars GCM V3.2 distributes it as DustScenario_MYxx.nc files (3° × 3° bins, daily) — this is the source of the NeuroNexus dust panel (variable `tau`, with `zmax` the dust-top altitude in km of the modified Conrath vertical profile).

## Global topography and major regions
- Elevations are referenced to the MOLA areoid (an equipotential surface); the MOLA global topography dataset (Smith et al. 2001) has ~1 m vertical precision and is the basis for NeuroNexus terrain (MEGDR 128 pixels/degree ≈ 463 m/pixel at the equator).
- Hemispheric dichotomy: rugged, heavily cratered southern highlands vs. smooth, low northern plains (several km lower).
- Tharsis: a vast volcanic rise (~5,000 km across) hosting Olympus Mons (summit ≈ 21.9 km above the datum, ~600 km wide — the tallest volcano in the solar system) and the three Tharsis Montes (Arsia, Pavonis, Ascraeus Mons).
- Valles Marineris: canyon system ~4,000 km long, up to ~7 km deep and ~200 km wide.
- Hellas Planitia: impact basin ~2,300 km across; its floor (≈ −7.2 km) is the lowest broad region on Mars.
- Other key regions: Argyre and Isidis basins; Elysium volcanic province; Arabia Terra; Utopia, Acidalia, Chryse and Amazonis Planitiae; the north and south polar layered deposits.
- Named-feature conventions (IAU/USGS Gazetteer of Planetary Nomenclature): crater; mons (mountain); patera (shallow volcano); vallis (valley); chasma (canyon); planitia (low plain); planum (high plain); terra (extensive land mass); fossae (troughs); labyrinthus (intersecting valleys); dorsum (ridge); tholus (small domical mountain).

## Geologic history
- Pre-Noachian (> ~4.1 Ga): crust formation, dichotomy, early magnetic field.
- Noachian (~4.1–3.7 Ga): heavy bombardment, valley networks, lakes (e.g. Jezero, Gale), clay (phyllosilicate) formation — the most habitable surface conditions.
- Hesperian (~3.7–3.0 Ga): widespread volcanism, outflow channels, sulfate-rich deposits, drying climate.
- Amazonian (~3.0 Ga–present): cold, dry, low erosion rates; glaciers, polar deposits, recent small-scale volcanism (Cerberus Fossae lavas are geologically young).
- Boundary ages are approximate (crater-count model ages).

## Water and ice
- Polar caps: north residual cap is mostly water ice (~1,000 km across, layered deposits up to ~3 km thick); the south residual cap has a thin CO₂ ice veneer over water ice.
- Ground ice is widespread poleward of ~±40–50° latitude; Phoenix (2008, 68° N) exposed water ice a few centimetres below the surface. Fresh impact craters and exposed scarps (HiRISE) reveal relatively pure ice at mid-latitudes, important for human ISRU.
- Ancient water evidence: valley networks, deltas (Jezero, Eberswalde), lake sediments (Gale), hydrated minerals (clays, sulfates, carbonates), hematite concretions (Meridiani).
- Recurring slope lineae (RSL) were once proposed as brines but are now widely interpreted as granular flows; treat claims of present-day liquid water with caution.
- Perchlorate salts (found by Phoenix, confirmed by Curiosity) are common in the soil; they are toxic to humans and lower the freezing point of brines.

## Moons
- Phobos: ~27 × 22 × 18 km; orbits ~9,376 km from Mars' centre (≈ 6,000 km altitude) every 7 h 39 m — faster than Mars rotates, so it rises in the west. It is slowly spiralling inward.
- Deimos: ~15 × 12 × 11 km; orbits ~23,460 km from Mars' centre every 30.3 h.
- Both discovered by Asaph Hall in August 1877. Their origin (captured asteroids vs. impact debris) is the target of JAXA's MMX mission.

## Radiation environment
- Mars lacks a global magnetic field and has a thin atmosphere (~16–20 g/cm² column vs. ~1,000 g/cm² on Earth).
- Curiosity RAD measured ≈ 0.64 ± 0.12 mSv/day on the surface at Gale (Hassler et al. 2014) and ≈ 1.8 mSv/day during cruise.
- A ~860-day reference mission (cruise + 500 days on the surface) accumulates roughly 1 Sv in total — comparable to or above career limits under older NASA standards. Solar particle events add acute risk; shielding with regolith, water or subsurface habitats reduces dose. Lower-elevation sites have slightly more atmospheric shielding.

## Surface materials
- Basaltic crust; reddish colour from fine ferric-oxide dust.
- Regolith contains perchlorates, sulfates and iron oxides; dust grains average a few microns in size.
- Thermal inertia (THEMIS / TES) distinguishes loose dust (low), sand, and rock or indurated surfaces (high). NeuroNexus uses THEMIS brightness temperatures as historical thermal evidence, not as a live temperature.
