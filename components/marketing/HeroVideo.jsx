'use client';

/**
 * Hero video background.
 * Serves from /public/videos/hero-bg.mp4 (self-hosted for reliability & performance).
 *
 * To replace the video:
 * 1. Download your chosen video from one of the options below
 * 2. Rename it hero-bg.mp4 and drop it into /public/videos/
 * 3. No code changes needed.
 *
 * Recommended Pexels videos (free, no attribution required):
 *   BEST - Team planning on whiteboard (process mapping):
 *   https://www.pexels.com/video/men-planning-together-while-using-whiteboard-9365375/
 *
 *   ALT 1 - Aerial view of collaborative team working:
 *   https://www.pexels.com/video/top-view-of-people-working-as-a-team-3195441/
 *
 *   ALT 2 - Strategy session in conference room:
 *   https://www.pexels.com/video/people-in-a-conference-room-for-a-business-meeting-3205624/
 *
 *   ALT 3 - Team discussing operations at work:
 *   https://www.pexels.com/video/people-having-a-meeting-and-discussion-at-work-3248990/
 *
 * Download tip: on each page, click the download button (top-right), choose HD (1080p).
 */

export default function HeroVideo() {
  return (
    <video
      className="hero-video"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
    >
      <source src="/videos/hero-bg.mp4" type="video/mp4" />
    </video>
  );
}
