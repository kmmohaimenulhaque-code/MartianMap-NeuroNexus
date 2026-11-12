import { SheetHead } from "../mobile/MobileDock";
import { Panel } from "./Panel";
import DustScenarioPanel from "../../panels/DustScenarioPanel";
import SiteMorphologyPanel from "../../panels/SiteMorphologyPanel";
import SiteSciencePanel from "../mars/SiteSciencePanel";
import MissionOpsPanel from "../mission/MissionOpsPanel";
import MarsBriefingPanel from "../mars/MarsBriefingPanel";
import InterpretationPanel from "./InterpretationPanel";

/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */
export default function RightColumn({ dust, dustPlaying, environment, handleOpenOrbital, handleSelectCoordinate, missionConsoleState, missionProfile, selectedLocation, setDustPlaying, setMissionProfile, setSol, siteScience, sol, terrain }) {
  return (
    <aside className="right-column">
      <SheetHead title="MISSION" />
      <Panel eyebrow="ATMOSPHERE / NASA AMES" title="Dust scenario" id="panel-dust" sources={["NASA_AMES_MGCM"]}>
        <DustScenarioPanel
          location={selectedLocation}
          sol={sol}
          onSolChange={setSol}
          onSelectCoordinate={handleSelectCoordinate}
          fallbackDust={dust}
          playing={dustPlaying}
          onPlayingChange={setDustPlaying}
        />
      </Panel>

      <Panel eyebrow="TERRAIN / NASA MOLA" title="Site morphology" id="panel-morphology" sources={["MOLA_MEGDR"]}>
        <SiteMorphologyPanel location={selectedLocation} terrain={terrain} />
      </Panel>

      <Panel eyebrow="SITE SCIENCE / SURVIVAL" title="Material + habitability context" id="panel-site-science" sources={["USGS_SIM_3292", "NASA_CURIOSITY"]}>
        <SiteSciencePanel science={siteScience} />
      </Panel>

      <InterpretationPanel
        environment={environment}
        siteScience={siteScience}
      />

      <Panel eyebrow="MISSION / OPERATIONS" title="Crewed Mars console" id="panel-crew" sources={["NN_MISSION_SIM"]}>
        <MissionOpsPanel
          consoleState={missionConsoleState}
          profile={missionProfile}
          onProfileChange={setMissionProfile}
          onOpenOrbital={handleOpenOrbital}
        />
      </Panel>

      <Panel eyebrow="BRIEFING / NASA FEED" title="Mars reference feed" id="panel-feed" sources={["NASA_MARS"]}>
        <MarsBriefingPanel />
      </Panel>
    </aside>
  );
}
