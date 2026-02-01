# Cursor + Vercel Deployment Guide

## Quick Start (5 Minutes to Live Site)

### Prerequisites
- Cursor installed (cursor.sh)
- Git installed
- Vercel account (vercel.com - sign up with GitHub)

---

## STEP-BY-STEP DEPLOYMENT

### Step 1: Set Up Project in Cursor (2 minutes)

1. **Open Cursor**
   - Launch Cursor IDE

2. **Create project folder**
   ```bash
   mkdir workflow-consultancy
   cd workflow-consultancy
   ```

3. **Initialize Git**
   ```bash
   git init
   ```

4. **Create project structure**
   ```
   workflow-consultancy/
   ├── index.html          (your main website file)
   ├── vercel.json         (Vercel configuration)
   ├── README.md           (project documentation)
   └── .gitignore          (files to ignore)
   ```

### Step 2: Add Files (1 minute)

**Create these files in Cursor:**

1. Copy `consultancy_website.html` → `index.html`
2. Create `vercel.json` (see below)
3. Create `.gitignore` (see below)
4. Create `README.md` (see below)

### Step 3: Customize Contact Info (1 minute)

**In index.html, find and replace:**

```javascript
// In Cursor, use Cmd+F (Mac) or Ctrl+F (Windows)
// Find and replace all instances:

contact@workflow-partners.com → your-email@yourdomain.com
+44 (0) 20 1234 5678 → your-phone-number
London, United Kingdom → Your City, Country
```

**Critical locations to update:**
- Line ~1040: CTA email link
- Line ~1090: Footer email
- Line ~1095: Footer phone
- Line ~1100: Footer location

### Step 4: Deploy to Vercel (1 minute)

**Option A: Vercel CLI (Fastest)**

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (follow prompts)
vercel

# Deploy to production
vercel --prod
```

**Option B: Vercel Dashboard (Easiest)**

1. Push code to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/workflow-consultancy.git
   git push -u origin main
   ```

2. Go to vercel.com/dashboard
3. Click "Add New" → "Project"
4. Import your GitHub repository
5. Click "Deploy"

**Your site is now live!** 🎉

---

## FILE TEMPLATES

### vercel.json
```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.html",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    },
    {
      "source": "/(.*)\\.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    }
  ]
}
```

### .gitignore
```
# Vercel
.vercel

# OS Files
.DS_Store
Thumbs.db

# Editor
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
*.swp
*.swo
*~

# Logs
*.log
npm-debug.log*

# Temporary files
*.tmp
.cache/

# Environment variables (if you add them later)
.env
.env.local
.env.*.local
```

### README.md
```markdown
# Workflow Consultancy Partners

Technology-agnostic workflow optimization and data strategy consulting.

## Tech Stack
- HTML/CSS/JavaScript
- Deployed on Vercel
- Custom domain: [yourdomain.com]

## Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/workflow-consultancy.git

# Open in browser
open index.html
# or
python -m http.server 8000  # then visit localhost:8000
```

## Deployment

```bash
# Deploy to production
vercel --prod
```

## Contact
- Email: your-email@domain.com
- Website: https://yourdomain.com
```

---

## CURSOR-SPECIFIC TIPS

### Using Cursor AI Features

**1. Quick Edits with Cmd+K**
```
Select text in index.html → Cmd+K → Type instruction:
"Change this section's background color to light blue"
"Make this text larger and bold"
"Add a hover effect to this button"
```

**2. Cursor Chat for Code Questions**
```
Cmd+L to open chat:
"How do I add a contact form to this website?"
"What's the best way to optimize this for mobile?"
"Help me add Google Analytics to the head section"
```

**3. Multi-cursor Editing**
```
Cmd+D (Mac) or Ctrl+D (Windows):
Select a word → Cmd+D repeatedly to select all instances
Edit them all simultaneously
Great for updating brand names, colors, etc.
```

### Recommended Cursor Settings

**File: .vscode/settings.json** (create if doesn't exist)
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "html.format.wrapLineLength": 120,
  "editor.tabSize": 2,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000
}
```

---

## CUSTOM DOMAIN SETUP

### Step 1: Purchase Domain

**Recommended registrars:**
- Namecheap (easiest)
- Cloudflare (cheapest)
- Google Domains (simplest)

**Suggested domains to check:**
1. `workflowpartners.co.uk` ⭐ Best choice
2. `workflow-optimization.co.uk`
3. `adaptiveops.co.uk`
4. `workflowconsultancy.uk`

### Step 2: Configure in Vercel

1. Go to your project in Vercel dashboard
2. Click "Settings" → "Domains"
3. Add your domain (e.g., `workflowpartners.co.uk`)
4. Vercel will show DNS records to add

### Step 3: Update DNS Records

**At your domain registrar, add these records:**

```
Type: A
Name: @
Value: 76.76.21.21

Type: CNAME
Name: www
Value: cname.vercel-dns.com
```

**Wait 24-48 hours for DNS propagation**

### Step 4: Enable SSL

Vercel automatically provisions SSL certificates via Let's Encrypt. No action needed!

---

## LOCAL DEVELOPMENT WORKFLOW

### Option 1: Simple HTTP Server (No build step needed)

```bash
# Using Python (built-in on Mac/Linux)
cd workflow-consultancy
python3 -m http.server 8000

# Visit: http://localhost:8000
```

### Option 2: Live Server in Cursor

1. Install "Live Server" extension in Cursor
2. Right-click `index.html`
3. Select "Open with Live Server"
4. Auto-reloads on save! ✨

### Option 3: Vercel Dev (Most accurate)

```bash
# Run Vercel development server
vercel dev

# Visit: http://localhost:3000
```

---

## UPDATING & REDEPLOYING

### Quick Update Workflow

```bash
# 1. Make changes in Cursor
# Edit index.html, save changes

# 2. Test locally
python3 -m http.server 8000
# or use Live Server

# 3. Commit changes
git add .
git commit -m "Update: description of changes"
git push

# 4. Deploy to Vercel
vercel --prod

# OR if using GitHub integration:
# Vercel auto-deploys on push to main branch
```

### Rollback if Needed

```bash
# View deployments
vercel ls

# Rollback to previous deployment
vercel rollback
```

---

## ADDING FEATURES LATER

### 1. Contact Form (Formspree)

**In Cursor, add before closing `</section>` in CTA section:**

```html
<form action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
  <div style="display: grid; gap: 1rem; max-width: 500px; margin: 0 auto;">
    <input type="text" name="name" placeholder="Your Name" required 
           style="padding: 1rem; border: 2px solid var(--border); border-radius: 6px; font-size: 1rem;">
    <input type="email" name="email" placeholder="Your Email" required
           style="padding: 1rem; border: 2px solid var(--border); border-radius: 6px; font-size: 1rem;">
    <textarea name="message" placeholder="Tell us about your challenges" rows="4" required
              style="padding: 1rem; border: 2px solid var(--border); border-radius: 6px; font-size: 1rem;"></textarea>
    <button type="submit" class="btn-primary">Send Message</button>
  </div>
</form>
```

### 2. Google Analytics

**Add before closing `</head>` tag:**

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### 3. Calendly Integration

**Replace email CTA button with:**

```html
<a href="https://calendly.com/your-link/30min" 
   class="btn-primary" 
   target="_blank" 
   rel="noopener">
  Schedule Discovery Call
</a>
```

---

## ENVIRONMENT VARIABLES (Optional)

If you need to hide API keys or config:

### Create `.env.local`
```
FORMSPREE_ID=your_formspree_id
GA_TRACKING_ID=G-XXXXXXXXXX
```

### Update vercel.json
```json
{
  "env": {
    "FORMSPORE_ID": "@formspree-id",
    "GA_TRACKING_ID": "@ga-tracking-id"
  }
}
```

### Add to Vercel Dashboard
Settings → Environment Variables → Add each variable

---

## PERFORMANCE OPTIMIZATION

### 1. Image Optimization

If you add images later:

```bash
# Install Sharp for image optimization
npm install sharp

# Create optimize script
```

**Or use Vercel Image Optimization:**
```html
<img src="/api/image?url=/your-image.jpg&w=800" alt="Description">
```

### 2. Font Optimization

Current setup already uses:
- Preconnect to Google Fonts
- Font-display: swap
- Only loads 2 font families

**To add fonts:**
1. Visit fonts.google.com
2. Select fonts
3. Copy `<link>` tag to `<head>`
4. Use `font-family` in CSS

### 3. Code Minification

```bash
# Install minifier
npm install -g html-minifier

# Minify HTML
html-minifier --collapse-whitespace --remove-comments index.html -o index.min.html

# Update vercel.json to use minified version (optional)
```

---

## MONITORING & ANALYTICS

### Vercel Analytics (Built-in)

**Enable in dashboard:**
1. Go to project → Analytics
2. Toggle on "Enable Analytics"
3. View real-time data:
   - Page views
   - Top pages
   - Top referrers
   - Devices
   - Locations

### Google Search Console

**Set up after deployment:**

1. Go to search.google.com/search-console
2. Add property: `https://yourdomain.com`
3. Verify ownership (Vercel auto-verifies)
4. Submit sitemap: `https://yourdomain.com/sitemap.xml`

**Create sitemap.xml** (in project root):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://yourdomain.com</loc>
    <lastmod>2026-02-01</lastmod>
    <priority>1.0</priority>
  </url>
</urlset>
```

---

## TROUBLESHOOTING

### Issue: Site not updating after deployment

**Solution:**
```bash
# Hard refresh browser
Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

# Clear Vercel cache
vercel --force

# Check deployment logs
vercel logs
```

### Issue: Custom domain not working

**Solution:**
```bash
# Verify DNS propagation
nslookup yourdomain.com

# Check Vercel domain status
# Dashboard → Settings → Domains
# Should show green checkmark

# Wait 24-48 hours for full propagation
```

### Issue: Form not submitting

**Solution:**
- Check Formspree dashboard for quota
- Verify form action URL is correct
- Test with different email address
- Check browser console for errors (F12)

### Issue: Slow loading

**Solution:**
```bash
# Test performance
https://pagespeed.web.dev/

# Enable Vercel Speed Insights
# Dashboard → Settings → Speed Insights → Enable

# Optimize images
# Compress all images: tinypng.com
```

---

## CURSOR AI PROMPTS FOR COMMON TASKS

### Change Color Scheme
```
Select CSS :root section → Cmd+K:
"Change the color scheme to use green (#2D7A3E) as primary instead of blue"
```

### Add New Section
```
Cmd+L (Chat):
"Add a new testimonials section after the services section with a 3-column grid layout"
```

### Mobile Responsiveness
```
Select section → Cmd+K:
"Make this section stack vertically on mobile devices"
```

### SEO Improvements
```
Cmd+L (Chat):
"Improve the SEO of this page by suggesting meta tag improvements and content changes"
```

### Accessibility Audit
```
Cmd+L (Chat):
"Audit this HTML for accessibility issues and suggest fixes"
```

---

## DEPLOYMENT CHECKLIST

### Before First Deploy
- [ ] Updated all contact information (email, phone, location)
- [ ] Tested all internal links
- [ ] Verified responsive design on mobile
- [ ] Spell-checked all content
- [ ] Added Google Analytics code
- [ ] Created favicon
- [ ] Tested locally with Live Server

### Deploy to Vercel
- [ ] Pushed code to GitHub
- [ ] Connected GitHub repo to Vercel
- [ ] Deployed successfully
- [ ] Verified live site loads
- [ ] Tested on mobile device
- [ ] Checked console for errors (F12)

### Post-Deploy
- [ ] Set up custom domain
- [ ] Enabled SSL (automatic)
- [ ] Submitted to Google Search Console
- [ ] Added site to LinkedIn profile
- [ ] Updated email signature with link
- [ ] Shared on social media

---

## QUICK REFERENCE COMMANDS

```bash
# Development
python3 -m http.server 8000     # Local server
vercel dev                       # Vercel dev server

# Deployment
vercel                          # Deploy to preview
vercel --prod                   # Deploy to production
vercel logs                     # View deployment logs
vercel domains                  # Manage domains
vercel rollback                 # Rollback deployment

# Git
git status                      # Check changes
git add .                       # Stage all changes
git commit -m "message"         # Commit changes
git push                        # Push to GitHub

# Cursor
Cmd+K                          # Quick edit
Cmd+L                          # AI chat
Cmd+P                          # Quick file open
Cmd+Shift+P                    # Command palette
Cmd+D                          # Multi-select
```

---

## NEXT STEPS

### Week 1
1. Deploy basic site to Vercel
2. Set up custom domain
3. Add Google Analytics
4. Share on LinkedIn

### Week 2
1. Add contact form (Formspree)
2. Integrate Calendly
3. Set up Google Search Console
4. Create 3 LinkedIn posts linking to site

### Week 3
1. Monitor analytics
2. A/B test hero headline
3. Add testimonials (as you get them)
4. Write first blog post

### Month 2
1. Add blog section
2. Create lead magnet
3. Set up email newsletter
4. Start SEO content strategy

---

## SUPPORT RESOURCES

### Vercel Documentation
- Docs: vercel.com/docs
- CLI Reference: vercel.com/docs/cli
- GitHub Integration: vercel.com/docs/git

### Cursor Resources
- Docs: cursor.sh/docs
- Community: cursor.sh/community
- Keyboard Shortcuts: cursor.sh/shortcuts

### Web Development
- MDN Web Docs: developer.mozilla.org
- CSS Tricks: css-tricks.com
- Can I Use: caniuse.com

---

## FINAL TIPS

1. **Commit often**: Make small, frequent commits with clear messages
2. **Test locally first**: Always test changes before deploying
3. **Use preview deployments**: Vercel creates preview URLs for each commit
4. **Monitor analytics**: Check Vercel Analytics weekly
5. **Stay updated**: Keep dependencies current with `npm update`
6. **Backup regularly**: GitHub = automatic backup
7. **Use Cursor AI**: Let AI help with repetitive tasks

**You're ready to deploy!** 🚀

The combination of Cursor (best AI-powered editor) + Vercel (best deployment platform) gives you a professional development workflow used by companies like Airbnb, Uber, and Nike.

Your site will be live in minutes, automatically SSL-secured, globally distributed on Vercel's CDN, and ready to scale.
```
