/**
 * 護送卡與攔截卡產出的設定。**九關改版（2026-09-13）之後的現況。**
 *
 * **重新產生**：見 `test/tools/mission-config-baseline.probe.ts` 的檔頭。
 * **不要手改這裡的數字** —— 手改一個位數就等於悄悄放寬了一條護欄。
 *
 * 【這一份不再是掃描的結果】上一版釘的是三條戰役那一輪之前掃描定出來的幾何、
 * 偏置與編制。九關改版把盟 M1 換成柏林的十六架箱型、德 M1 換成擊落規則，
 * **那次掃描就是這一輪刻意丟掉的東西** —— 現在的每一個數字都是起始值，
 * 待試飛裁定。它守的因此不再是「別把掃描結果弄丟」，而是
 * 「別在沒有人打算改卡片的時候讓設定悄悄漂移」。
 *
 * 【攔截那一張是合成卡】出貨的九關沒有攔截卡了（德 M1 的規則是 hunt）。
 * `INTERCEPT_CARD` 由 `test/fixtures/mission.ts` 從護送卡鏡像出來，
 * 所以它跟著護送卡動 —— 改盟 M1 會讓兩張都要重產。
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
        "lane": -0.3125,
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
        "lane": -0.1875,
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
        "lane": -0.0625,
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
        "lane": 0.0625,
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
        "lane": 0.1875,
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
        "lane": 0.3125,
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
        "lane": 0.0625,
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
        "lane": 0.1875,
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
        "lane": 0.3125,
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
        "lane": 0.4375,
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
        "lane": 0.5625,
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
        "lane": -0.0625,
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
        "lane": -0.1875,
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
        "lane": -0.3125,
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
        "lane": -0.4375,
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
        "lane": -0.5625,
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
      "trimTau": 1,
      "fireDelay": 0.1
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
      "convoyPriority": 3
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
        "lane": -0.0625,
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
        "lane": 0.0625,
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
        "lane": 0.0625,
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
        "lane": -0.0625,
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
      "trimTau": 1,
      "fireDelay": 0.1
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
      "convoyPriority": 3
    }
  }
} as const

