1. 

Airport Investment Intelligence Agent — 48 airports, analysis year 2025. Type /help for commands, /exit to quit.
> Which airports in New England are strong candidates for terminal expansion?
I couldn't verify my narration against the exact tool results, so here are those results directly:

{
  "results": [
    {
      "code": "PWM",
      "rank": 1,
      "result": {
        "kpi": "expansion_opportunity",
        "code": "PWM",
        "score": 66.8,
        "breakdown": [
          {
            "signal": "congestionScore",
            "raw": 51.05380426734073,
            "normalized": 51.1,
            "weight": 0.4000000000000001,
            "contribution": 20.4
          },
          {
            "signal": "unmetDemandScore",
            "raw": 91.3827968006893,
            "normalized": 91.4,
            "weight": 0.30000000000000004,
            "contribution": 27.4
          },
          {
            "signal": "paxGrowthYoy",
            "raw": 0.05323625654450259,
            "normalized": 87.4,
            "weight": 0.20000000000000004,
            "contribution": 17.5
          },
          {
            "signal": "logPassengers",
            "raw": 6.109739142051315,
            "normalized": 14.6,
            "weight": 0.10000000000000002,
            "contribution": 1.5
          }
        ],
        "droppedSignals": [],
        "confidence": 1,
        "weightsVersion": "1.0.0",
        "normalization": {
          "basis": "in-scope universe",
          "n": 48,
          "year": 2025,
          "caveat": "This score is relative to the ~48 major US airports in our dataset, not all ~400 US airports. A score of 90 means \"near the top of this set\", not \"top 10% nationally\"."
        }
      }
    },
    {
      "code": "BOS",
      "rank": 2,
      "result": {
        "kpi": "expansion_opportunity",
        "code": "BOS",
        "score": 64.4,
        "breakdown": [
          {
            "signal": "congestionScore",
            "raw": 56.30626486410381,
            "normalized": 56.3,
            "weight": 0.4000000000000001,
            "contribution": 22.5
          },
          {
            "signal": "unmetDemandScore",
            "raw": 72.77444528806161,
            "normalized": 72.8,
            "weight": 0.30000000000000004,
            "contribution": 21.8
          },
          {
            "signal": "paxGrowthYoy",
            "raw": -0.00820004999887225,
            "normalized": 60.6,
            "weight": 0.20000000000000004,
            "contribution": 12.1
          },
          {
            "signal": "logPassengers",
            "raw": 7.3244055016899905,
            "normalized": 79.3,
            "weight": 0.10000000000000002,
            "contribution": 7.9
          }
        ],
        "droppedSignals": [],
        "confidence": 1,
        "weightsVersion": "1.0.0",
        "normalization": {
          "basis": "in-scope universe",
          "n": 48,
          "year": 2025,
          "caveat": "This score is relative to the ~48 major US airports in our dataset, not all ~400 US airports. A score of 90 means \"near the top of this set\", not \"top 10% nationally\"."
        }
      }
    },
    {
      "code": "PVD",
      "rank": 3,
      "result": {
        "kpi": "expansion_opportunity",
        "code": "PVD",
        "score": 60.8,
        "breakdown": [
          {
            "signal": "congestionScore",
            "raw": 44.11922333089528,
            "normalized": 44.1,
            "weight": 0.4000000000000001,
            "contribution": 17.6
          },
          {
            "signal": "unmetDemandScore",
            "raw": 72.89765947966099,
            "normalized": 72.9,
            "weight": 0.30000000000000004,
            "contribution": 21.9
          },
          {
            "signal": "paxGrowthYoy",
            "raw": 0.06630381546328823,
            "normalized": 93.1,
            "weight": 0.20000000000000004,
            "contribution": 18.6
          },
          {
            "signal": "logPassengers",
            "raw": 6.326890052072303,
            "normalized": 26.1,
            "weight": 0.10000000000000002,
            "contribution": 2.6
          }
        ],
        "droppedSignals": [],
        "confidence": 1,
        "weightsVersion": "1.0.0",
        "normalization": {
          "basis": "in-scope universe",
          "n": 48,
          "year": 2025,
          "caveat": "This score is relative to the ~48 major US airports in our dataset, not all ~400 US airports. A score of 90 means \"near the top of this set\", not \"top 10% nationally\"."
        }
      }
    },
    {
      "code": "BDL",
      "rank": 4,
      "result": {
        "kpi": "expansion_opportunity",
        "code": "BDL",
        "score": 54.6,
        "breakdown": [
          {
            "signal": "congestionScore",
            "raw": 44.301858723402695,
            "normalized": 44.3,
            "weight": 0.4000000000000001,
            "contribution": 17.7
          },
          {
            "signal": "unmetDemandScore",
            "raw": 69.10139450810658,
            "normalized": 69.1,
            "weight": 0.30000000000000004,
            "contribution": 20.7
          },
          {
            "signal": "paxGrowthYoy",
            "raw": -0.003100850847286063,
            "normalized": 62.8,
            "weight": 0.20000000000000004,
            "contribution": 12.6
          },
          {
            "signal": "logPassengers",
            "raw": 6.517088433072078,
            "normalized": 36.3,
            "weight": 0.10000000000000002,
            "contribution": 3.6
          }
        ],
        "droppedSignals": [],
        "confidence": 1,
        "weightsVersion": "1.0.0",
        "normalization": {
          "basis": "in-scope universe",
          "n": 48,
          "year": 2025,
          "caveat": "This score is relative to the ~48 major US airports in our dataset, not all ~400 US airports. A score of 90 means \"near the top of this set\", not \"top 10% nationally\"."
        }
      }
    }
  ],
  "excluded": [
    {
      "code": "MHT",
      "reason": "below_min_volume",
      "passengers": 686314
    },
    {
      "code": "BTV",
      "reason": "below_min_volume",
      "passengers": 709116
    }
  ],
  "normalization": {
    "basis": "in-scope universe",
    "n": 48,
    "year": 2025,
    "caveat": "This score is relative to the ~48 major US airports in our dataset, not all ~400 US airports. A score of 90 means \"near the top of this set\", not \"top 10% nationally\"."
  }
}
[note: this answer was templated by the output-consistency check before being shown]
>


