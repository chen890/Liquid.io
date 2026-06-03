"""
Curated sector events with enriched metadata.
Imported by main.py to replace the inline SECTOR_EVENTS dict.
"""

SECTOR_EVENTS: dict[str, list[dict]] = {
    "ADAS_AV": [
        {
            "date": "2026-07-14",
            "label": "Intel Q2 2026 Earnings (Mobileye parent — INTC)",
            "description": "Intel owns 88% of Mobileye. Weak Intel results or a MBLY guidance cut can pressure MBLY stock. Watch for autonomous driving revenue commentary and any mention of an MBLY stake reduction.",
            "url": "https://www.intel.com/content/www/us/en/investor-relations/overview.html",
            "source": "NASDAQ", "type": "earnings_related", "impact": "high",
        },
        {
            "date": "2026-07-23",
            "label": "Alphabet Q2 2026 Earnings (Waymo parent — GOOG)",
            "description": "Waymo is Mobileye's largest robotaxi rival. Strong Waymo commercialization milestones shift AV sector sentiment. Weak results could benefit MBLY's relative positioning.",
            "url": "https://abc.xyz/investor/",
            "source": "NASDAQ", "type": "earnings_related", "impact": "medium",
        },
        {
            "date": "2026-07-28",
            "label": "NVIDIA Q2 FY2027 Earnings (ADAS chip rival)",
            "description": "NVDA DRIVE platform (Orin/Thor) is the most direct MBLY EyeQ competitor for ADAS SoCs. Strong NVDA automotive wins often weigh on MBLY. Key metric: automotive segment revenue and OEM booking backlog.",
            "url": "https://investor.nvidia.com/",
            "source": "NASDAQ", "type": "earnings_related", "impact": "high",
        },
        {
            "date": "2026-08-12",
            "label": "Qualcomm Snapdragon Summit — ADAS platform roadmap",
            "description": "Qualcomm Snapdragon Ride Elite is a direct Mobileye competitor for mid-market ADAS. New OEM design wins announced here could affect Mobileye's design-win pipeline in the 2027–2029 launch window.",
            "url": "https://www.qualcomm.com/news/releases",
            "source": "Qualcomm", "type": "conference", "impact": "medium",
        },
        {
            "date": "2026-09-09",
            "label": "IAA Munich 2026 — OEM / Mobileye partner announcements",
            "description": "Europe's largest auto show. Mobileye typically announces new OEM design wins and SuperVision/Chauffeur system partnerships. Historically one of the most bullish catalysts for MBLY.",
            "url": "https://www.iaa.net/en/iaa-mobility",
            "source": "IAA", "type": "industry", "impact": "high",
        },
        {
            "date": "2026-10-27",
            "label": "Mobileye Q3 2026 Earnings (estimated)",
            "description": "Quarterly results. Key metrics: SuperVision attach rate, EyeQ6/7 chip volumes, Chauffeur program milestones, and full-year revenue guidance. This is the primary stock catalyst of the quarter.",
            "url": "https://investors.mobileye.com/news-releases",
            "source": "Projected", "type": "earnings", "impact": "high",
        },
        {
            "date": "2026-11-12",
            "label": "NXP Semiconductors Q3 2026 Earnings",
            "description": "NXP S32 series competes with EyeQ in ADAS ECUs. Automotive segment guidance signals industry-wide demand and pricing pressure on ADAS chips.",
            "url": "https://investors.nxp.com",
            "source": "NASDAQ", "type": "earnings_related", "impact": "low",
        },
        {
            "date": "2026-11-17",
            "label": "SEMICON Europe 2026",
            "description": "Major semiconductor industry conference in Munich. EV/AV chip roadmaps, advanced packaging announcements, and capacity expansion news that moves the sector.",
            "url": "https://www.semi.org/en/connect/events/semicon-europe",
            "source": "SEMI", "type": "conference", "impact": "low",
        },
        {
            "date": "2027-01-05",
            "label": "CES 2027 — Autonomous driving keynotes",
            "description": "Consumer Electronics Show, Las Vegas. AV partnerships, Level 3/4 commercialization milestones, and OEM Mobileye integrations are routinely announced here. Historically a high-impact event for MBLY.",
            "url": "https://www.ces.tech",
            "source": "CES", "type": "conference", "impact": "high",
        },
        {
            "date": "2027-01-27",
            "label": "Mobileye Q4 2026 / Full-Year Earnings (estimated)",
            "description": "Full-year results and 2027 guidance — the most important earnings report of the year. Sets investor expectations for volumes, ASP trajectory, Chauffeur launch timing, and R&D cost evolution.",
            "url": "https://investors.mobileye.com/news-releases",
            "source": "Projected", "type": "earnings", "impact": "high",
        },
    ],
    "SEMICONDUCTOR": [
        {
            "date": "2026-07-22",
            "label": "Texas Instruments Q2 2026 Earnings",
            "description": "TI automotive analog revenue is a leading indicator for overall auto semiconductor demand. Inventory corrections or demand weakness here often foreshadow sector-wide softness.",
            "url": "https://investor.ti.com/",
            "source": "NASDAQ", "type": "earnings_related", "impact": "medium",
        },
        {
            "date": "2026-07-28",
            "label": "NVIDIA Q2 FY2027 Earnings",
            "description": "NVDA automotive segment booking backlog directly measures competitive threat to Mobileye. Strong bookings compress MBLY's design-win opportunity in future model years.",
            "url": "https://investor.nvidia.com/",
            "source": "NASDAQ", "type": "earnings_related", "impact": "high",
        },
        {
            "date": "2026-08-06",
            "label": "NXP Semiconductors Q2 2026 Earnings",
            "description": "NXP automotive division guidance reflects ADAS SoC demand and near-term pricing trends across Tier-1 suppliers.",
            "url": "https://investors.nxp.com",
            "source": "NASDAQ", "type": "earnings_related", "impact": "low",
        },
        {
            "date": "2026-10-21",
            "label": "SIA Global Semiconductor Sales Report (Sep 2026)",
            "description": "Monthly chip sales data from the Semiconductor Industry Association. Automotive chip sales trends directly impact EV/ADAS semiconductor valuations.",
            "url": "https://www.semiconductors.org/semiconductor-sales/",
            "source": "SIA", "type": "macro", "impact": "medium",
        },
        {
            "date": "2026-11-17",
            "label": "SEMICON Europe 2026",
            "description": "Next-gen ADAS SoC roadmaps, EUV capacity plans, and automotive chip supply chain updates.",
            "url": "https://www.semi.org/en/connect/events/semicon-europe",
            "source": "SEMI", "type": "conference", "impact": "low",
        },
    ],
    "CLOUD_AI": [
        {
            "date": "2026-07-29",
            "label": "Microsoft Q4 FY2026 Earnings",
            "description": "Azure AI growth rate is a sentiment proxy for AI monetization. Positive AI capex guidance lifts semiconductor stocks broadly.",
            "url": "https://www.microsoft.com/en-us/investor",
            "source": "NASDAQ", "type": "earnings_related", "impact": "low",
        },
        {
            "date": "2026-07-30",
            "label": "Meta Q2 2026 Earnings",
            "description": "Meta AI infrastructure spend drives advanced chip demand. Upside guidance on AI capex benefits the semiconductor sector.",
            "url": "https://investor.fb.com/financial-information/quarterly-earnings/",
            "source": "NASDAQ", "type": "earnings_related", "impact": "low",
        },
        {
            "date": "2026-08-07",
            "label": "Amazon Q2 2026 Earnings",
            "description": "AWS AI/ML infrastructure capex signals data center chip demand. Strong guidance benefits TSMC utilization and indirectly supports ADAS chip supply.",
            "url": "https://ir.aboutamazon.com/quarterly-results",
            "source": "NASDAQ", "type": "earnings_related", "impact": "low",
        },
        {
            "date": "2026-09-09",
            "label": "Apple iPhone 18 Event (supply-chain signal)",
            "description": "Apple A-series silicon leadership and TSMC N3/N2 capacity allocation affects availability of advanced nodes used in Mobileye EyeQ chips.",
            "url": "https://www.apple.com/newsroom/",
            "source": "Apple", "type": "product", "impact": "low",
        },
    ],
}
