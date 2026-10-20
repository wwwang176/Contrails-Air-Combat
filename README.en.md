# Contrails Air: Combat

[中文](README.md) | **English**

*Contrails Air: Combat* is a browser WWII air-combat game with stylised **low-poly art**. Lead your flight on escort, interception, bombing and torpedo missions — use speed and altitude wisely to make it home from the furball.

## Play online

https://wwwang176.github.io/Contrails-Air-Combat/

## Features

- **Three campaigns, ten missions**: from European bomber routes, night raids and snowfield dive-bombing in the East to Pacific fleet defence and low-level torpedo runs.
- **Ten WWII aircraft**: each with its own speed, climb, turn, firepower and payload.
- **Energy-based dogfighting**: dive to gain speed; hard turns and climbs bleed energy.
- **Varied objectives**: escort, interception, air superiority, level bombing, airfield strafing, convoy interdiction and torpedo attacks.
- **Formation AI**: wingmen hold formation, cover their leader and pick their own targets.
- **Skirmish mode**: mix any aircraft on either side, up to 20 each, and choose terrain, altitude, time of day and the player's flight lead.
- **Living battlefield**: tracers, explosions, smoke, searchlights, splashes, wakes and wreckage keep the fight changing.
- **Immersive audio**: engines, guns and explosions carry direction and distance; far-off sounds are duller and arrive later.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/leuna-b17-formation.jpg" alt="B-17 formation over the Leuna refinery"><br><sub>The Leuna Refinery: a B-17 formation</sub></td>
    <td width="50%"><img src="docs/screenshots/rennell-torpedo-run.jpg" alt="G4M torpedo run at dusk off Rennell Island"><br><sub>Rennell Island: a G4M torpedo run at dusk</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/rzhev-stuka.jpg" alt="Stuka and tanks on the snowfield at Rzhev"><br><sub>Rzhev: a Stuka over the snowfield armour</sub></td>
    <td><img src="docs/screenshots/poltava-night-raid.jpg" alt="He 111s in the searchlights over Poltava"><br><sub>Night over Poltava: He 111s in the searchlights</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/berlin-escort.jpg" alt="P-51 on a Bf 109's tail over Berlin"><br><sub>Over Berlin: a P-51 on a Bf 109's tail</sub></td>
    <td><img src="docs/screenshots/okinawa-carrier.jpg" alt="Zero diving on the carrier off Okinawa"><br><sub>Off Okinawa: a Zero diving on the carrier</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/okinawa-dogfight.jpg" alt="F6F chasing a Zero off Okinawa"><br><sub>Off Okinawa: an F6F chasing a Zero</sub></td>
    <td><img src="docs/screenshots/leyte-beach-strafe.jpg" alt="Ki-84s strafing the beachhead at Leyte"><br><sub>The Leyte Front: Ki-84s strafing the beachhead</sub></td>
  </tr>
</table>

## Three campaigns

- **USA**: escort and strike over Europe, fleet defence off Okinawa. (Over Berlin · The Leuna Refinery · Off Okinawa)
- **Germany**: intercept the bomber streams, dive-bomb on the snowfield, raid by night and strafe airfields at low level. (Over Merseburg · Rzhev · Night over Poltava · Operation Bodenplatte)
- **Japan**: escort over Guadalcanal, cut the supply lines at Leyte and torpedo the fleet off Rennell Island. (Over Guadalcanal · The Leyte Front · Rennell Island)

## Aircraft

| Side | Fighters | Bombers |
| --- | --- | --- |
| USA | P-51D Mustang, F6F-5 Hellcat, F4F-4 Wildcat | B-17G Flying Fortress |
| Germany | Bf 109 K-4 | He 111 H-6, Ju 87 B-2 Stuka |
| Japan | Ki-84 Frank, A6M5 Zeke | G4M Betty |

The hangar shows each aircraft's looks, performance and history; skirmish lets you mix aircraft from both sides freely.

## Controls

| Input | Action |
| --- | --- |
| Mouse move | Move the aim point; the aircraft flies toward it |
| Left mouse button | Lock the mouse / fire; drop bombs or torpedoes in the bombsight view |
| Hold right mouse button and drag | Look around freely; recentres on release |
| `W` / `S` | Throttle up / throttle down and slow |
| `V` | Toggle first-person and third-person view |
| `B` | Toggle the bombing / torpedo view (where available); fighters carrying bombs drop them directly |
| `Tab` | Hold to show the battle status and scoreboard |
| `I` / `O` / `G` | AI takeover / formation order markers / free spectator camera |
| `Esc` | Release the mouse and open the pause menu |

In the free spectator camera, move with `W` `A` `S` `D`, rise and descend with `Q` `E`, and hold `Shift` to go faster.

## Play locally

```bash
npm install
npm run dev
```

Requires [Node.js](https://nodejs.org/); open `http://localhost:5173` once it starts. A desktop browser and mouse are recommended.

---

Built with TypeScript, Three.js and Vite.
