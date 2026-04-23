# Process audit tool - demo walkthrough video (production guide)

Use this document to **record or brief** a screen-capture demo of the client journey in the diagnostic (`/diagnostic`). It matches the current product flow described in `DIAGNOSTICS_CAPABILITIES.md`.

## Deliverable

- **Format:** MP4 (H.264), 1920×1080 or 1440×900, 30fps.
- **Length:** **2.5–4 minutes** for the primary cut; optional **6–8 minute** “deep dive” with the Full diagnostic path.
- **Audio:** Voiceover OR clean UI-only with captions (add captions in your editor or YouTube).

## Where to publish (after export)

The marketing page embeds a hosted player via **`DEMO_VIDEO_EMBED_URL`** in `app/MarketingClient.jsx` (YouTube / Vimeo / Loom **embed** URL, not a raw `.mp4` upload).

1. Upload your finished video to your host (e.g. YouTube as **Unlisted**).
2. Copy the **embed** URL and set `DEMO_VIDEO_EMBED_URL` in `MarketingClient.jsx`.

---

## Path to record (recommended): **Map only**

Best for a first demo: **no account**, **~15 minutes** flow in product, **~3 minutes** on video with tight editing.

| Step | Screen | In app |
|------|--------|--------|
| 1 | Intro chat (Sharp) | Choose **Process Map** → **Map only (~15 min)** |
| 2 | Template / process | Pick e.g. **Customer Onboarding** or a short custom name |
| 3 | Map Steps | Add 3–5 steps, expand one step (owner, system, handoff), show **flow preview** updating |
| 4 | Your Details | Fill name/email (use a demo alias), **Confirm and Generate** |
| 5 | Report | Land on `/report` - show headline sections briefly (scroll), **do not** show real client data |

**Skip:** Team Alignment, Comprehensive cost screen, auth - unless you make a second video.

---

## Shot list & narration beats (primary cut)

1. **Hook (0:00–0:15)**  
   Open `https://<your-domain>/diagnostic` (or localhost for internal).  
   *Say:* “This is Vesno’s free process audit - you walk through your real process, and we turn it into a map and analysis.”

2. **Sharp intro (0:15–0:45)**  
   Show **Process Map** vs **Team Alignment** cards (mention team is for alignment sessions).  
   Choose **Map only**.  
   Pick a **template** or type a short process name.  
   *Say:* “Sharp guides you through what to map - you pick how deep you want to go.”

3. **Map Steps - hero of the demo (0:45–2:00)**  
   - Add a few steps (e.g. Intake → Review → Approve → Hand off).  
   - Toggle **AI Chat** / **Step Editor** if it helps the story; show **step editor** detail on one step (department, system, handoff).  
   - Pan/zoom **flow preview**; click a node to jump to step.  
   *Say:* “You build the map step by step; the flowchart updates live. You can chat with Sharp or edit steps directly.”

4. **Optional quick feature (2:00–2:20)**  
   - **Save & get link** in the progress area (modal) - “resume later or share with a colleague.”  
   OR **Handover** from nav - “pass this step to someone else with a link.”  
   (Pick one so the video stays under ~4 minutes.)

5. **Your Details → report (2:20–3:15)**  
   Enter **demo** contact info only.  
   **Confirm and Generate** → brief **generating** state → **report** page.  
   Scroll through **sections** (flow, automation, cost/roadmap if present) - **blur or crop** anything sensitive.  
   *Say:* “You get a structured report - process view, automation signals, and next steps - not a static deck.”

6. **Close (3:15–3:30)**  
   CTA: “Start free at …” / link in description.

---

## Optional second video: **Full diagnostic (~30 min)**

- **Process Map** → **Full diagnostic (~30 min)** → sign in when prompted → **Map Steps** → **Cost & Impact** (Screen 4) → **Your Details** → report.  
- Emphasise **cost**, **bottleneck**, and **savings** sections on Screen 4 and in the report.  
- Longer: **5–8 minutes** edited or chapter-marked.

---

## Recording checklist

- [ ] Use a **fresh browser profile** or incognito to avoid leaking real emails/sessions.  
- [ ] **Demo-only** name/email/company; no production customer data.  
- [ ] **Hide bookmarks bar**; close unnecessary tabs; **DND** on notifications.  
- [ ] Cursor: use a **large, visible** pointer (OS or OBS).  
- [ ] If Supabase auth appears, use a **demo account** created for marketing.  
- [ ] If anything fails, **cut** or **retake** - don’t show API errors in production marketing.  
- [ ] **Blur or crop** report IDs/URLs if they contain tokens.

---

## Optional chapters (for YouTube / Vimeo)

- `0:00` - Intro & opening the tool  
- `0:45` - Sharp: path and mode  
- `1:15` - Map steps & flow preview  
- `2:20` - Details & generating report  
- `2:50` - Report walkthrough  

---

## Related code (for product accuracy)

| Area | Location |
|------|----------|
| Welcome / Sharp | `components/diagnostic/IntroChatScreen.jsx` |
| Map Steps | `components/diagnostic/screens/Screen2MapSteps.jsx` |
| Cost (full path) | `components/diagnostic/screens/Screen4Cost.jsx` |
| Your Details | `components/diagnostic/screens/Screen5YourDetails.jsx` |
| Complete → report | `components/diagnostic/screens/Screen6Complete.jsx` |
| Full journey doc | `DIAGNOSTICS_CAPABILITIES.md` |

---

## Tools (free / common)

- **OBS Studio** (screen + mic), **QuickTime** (macOS), **Xbox Game Bar** (Windows), or **Loom**.  
- Edit in **DaVinci Resolve**, **CapCut**, or **iMovie**; export H.264 MP4.
