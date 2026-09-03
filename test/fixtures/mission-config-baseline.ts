/**
 * 「三條戰役」那一輪之前，兩張有實測基礎的卡產出的設定。
 *
 * **重新產生**：見 `test/tools/mission-config-baseline.probe.ts` 的檔頭。
 * **不要手改這裡的數字** —— 手改一個位數就等於悄悄放寬了一條護欄。
 *
 * 【為什麼只有這兩張】它們是唯二有實測基礎的關卡（護送／攔截的幾何、偏置與
 * 編制是 2026-08-21 掃描定的）。改寫成新形狀之後產出的設定必須一模一樣。
 */
export const MISSION_CONFIG_BASELINE = {
  "allies-escort": {
    "units": [
      {
        "team": "blue",
        "members": [
          "p51d",
          "p51d",
          "p51d",
          "p51d"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "combat",
        "lane": 0,
        "tier": 4,
        "player": true
      },
      {
        "team": "blue",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "transit",
        "lane": -0.375,
        "tier": 0,
        "player": false
      },
      {
        "team": "blue",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "transit",
        "lane": -0.125,
        "tier": 0,
        "player": false
      },
      {
        "team": "blue",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "transit",
        "lane": 0.125,
        "tier": 0,
        "player": false
      },
      {
        "team": "blue",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "transit",
        "lane": 0.375,
        "tier": 0,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "bf109k4",
          "bf109k4",
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "combat",
        "lane": -1,
        "tier": 4,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "bf109k4",
          "bf109k4",
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "combat",
        "lane": 0,
        "tier": 4,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "combat",
        "lane": 1,
        "tier": 4,
        "player": false
      }
    ],
    "altitude": 4000,
    "tas": 200,
    "entryRange": 10000,
    "schwarmSpacing": 800,
    "lateralOffset": 1500,
    "altitudeSpread": 300,
    "aiProfile": {
      "reactionDelay": 0.3,
      "aimError": 0,
      "trimTau": 1
    },
    "rules": {
      "kind": "convoy",
      "owner": "blue",
      "point": [
        -750,
        4000,
        -12000
      ],
      "radius": 1000
    },
    "tuning": {
      "convoyPriority": 5
    }
  },
  "axis-intercept": {
    "units": [
      {
        "team": "blue",
        "members": [
          "bf109k4",
          "bf109k4",
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "combat",
        "lane": -1,
        "tier": 4,
        "player": false
      },
      {
        "team": "blue",
        "members": [
          "bf109k4",
          "bf109k4",
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "combat",
        "lane": 0,
        "tier": 4,
        "player": true
      },
      {
        "team": "blue",
        "members": [
          "bf109k4",
          "bf109k4"
        ],
        "entry": {
          "along": 0.5,
          "across": -0.5,
          "gap": 0,
          "climb": 0,
          "heading": 0,
          "speed": 1
        },
        "duty": "combat",
        "lane": 1,
        "tier": 4,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "p51d",
          "p51d",
          "p51d",
          "p51d"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "combat",
        "lane": 0,
        "tier": 4,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "transit",
        "lane": -0.375,
        "tier": 0,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "transit",
        "lane": -0.125,
        "tier": 0,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "transit",
        "lane": 0.125,
        "tier": 0,
        "player": false
      },
      {
        "team": "red",
        "members": [
          "b17g"
        ],
        "entry": {
          "along": -0.5,
          "across": 0.5,
          "gap": 0,
          "climb": 0,
          "heading": 3.141592653589793,
          "speed": 1
        },
        "duty": "transit",
        "lane": 0.375,
        "tier": 0,
        "player": false
      }
    ],
    "altitude": 4000,
    "tas": 200,
    "entryRange": 10000,
    "schwarmSpacing": 800,
    "lateralOffset": 1500,
    "altitudeSpread": 300,
    "aiProfile": {
      "reactionDelay": 0.3,
      "aimError": 0,
      "trimTau": 1
    },
    "rules": {
      "kind": "convoy",
      "owner": "red",
      "point": [
        750,
        4000,
        12000
      ],
      "radius": 1000
    },
    "tuning": {
      "convoyPriority": 5
    }
  }
} as const

